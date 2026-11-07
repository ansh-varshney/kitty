import { beforeEach, describe, expect, it } from "vitest";
import { paypalRequest, resetTokenCache } from "./rest";

process.env.PAYPAL_CLIENT_ID = "test-client-id-123";
process.env.PAYPAL_CLIENT_SECRET = "test-client-secret-123";
process.env.GEMINI_API_KEY = "test-gemini-key-123";

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "tok", expires_in: 32000 }), { status: 200 });
    }
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("PayPal REST client (FR-PP-1, FR-PP-4)", () => {
  beforeEach(() => resetTokenCache());

  it("sends the same idempotency key on every retry of a POST", async () => {
    const { impl, calls } = fakeFetch([{ status: 503 }, { status: 201, body: { id: "X" } }]);
    const res = await paypalRequest<{ id: string }>("POST", "/v1/payments/payouts", { body: {}, fetchImpl: impl });
    expect(res.id).toBe("X");
    const posts = calls.filter((c) => c.url.endsWith("/v1/payments/payouts"));
    expect(posts).toHaveLength(2);
    const ids = posts.map((c) => (c.init.headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).toBe(ids[1]);
  });

  it("does not retry a 4xx validation error", async () => {
    const { impl, calls } = fakeFetch([{ status: 422, body: { name: "UNPROCESSABLE_ENTITY" } }]);
    await expect(paypalRequest("POST", "/v1/payments/payouts", { body: {}, fetchImpl: impl })).rejects.toThrow(/422/);
    expect(calls.filter((c) => c.url.endsWith("/v1/payments/payouts"))).toHaveLength(1);
  });

  it("caches the app token across calls", async () => {
    const { impl, calls } = fakeFetch([{ status: 200, body: {} }]);
    await paypalRequest("GET", "/a", { fetchImpl: impl });
    await paypalRequest("GET", "/b", { fetchImpl: impl });
    expect(calls.filter((c) => c.url.endsWith("/v1/oauth2/token"))).toHaveLength(1);
  });
});
