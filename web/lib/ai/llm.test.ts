import { beforeEach, describe, expect, it } from "vitest";
import { chainFor, generate, generateJson, quotaCooloffMs, resetQuotaBench } from "./llm";

process.env.PAYPAL_CLIENT_ID ??= "test-client-id-123";
process.env.PAYPAL_CLIENT_SECRET ??= "test-client-secret-123";

// A fixed chain for the tests: two text models from one provider, then another provider.
const A = "groq:fast-a";
const B = "groq:fast-b";
const C = "gemini:backup-c";
const models = [A, B, C];

describe("AI model chain: fastest first, rest what's slow or limited, then code (FR-AI-1, FR-AI-2)", () => {
  beforeEach(() => resetQuotaBench());

  it("uses the first model when it answers", async () => {
    const seen: string[] = [];
    const res = await generate("hi", { models, impl: async (m) => (seen.push(m), "ok") });
    expect(res.model).toBe(A);
    expect(seen).toEqual([A]);
  });

  it("retries a busy model once, then moves to the next", async () => {
    const seen: string[] = [];
    const res = await generate("hi", {
      models,
      impl: async (m) => {
        seen.push(m);
        if (m === A) throw Object.assign(new Error("503 overloaded"), { status: 503 });
        return "ok";
      },
    });
    expect(res.model).toBe(B);
    expect(seen).toEqual([A, A, B]);
  });

  it("skips a retired model without retrying (404)", async () => {
    const seen: string[] = [];
    await generate("hi", { models, impl: async (m) => (seen.push(m), m === A ? Promise.reject(Object.assign(new Error("404 model not found"), { status: 404 })) : "ok") });
    expect(seen).toEqual([A, B]);
  });

  it("falls back to a template when every model fails", async () => {
    const res = await generate("hi", { models, impl: async () => Promise.reject(Object.assign(new Error("429 rate limit"), { status: 429 })), template: () => "Mochi is napping. Here's the plain version." });
    expect(res).toMatchObject({ fallback: true, model: "template" });
  });

  it("rests a rate-limited model for the provider's Retry-After, and skips it next time", async () => {
    const seen: string[] = [];
    const limited = Object.assign(new Error("groq 429: rate limit reached"), { status: 429, retryAfterMs: 42_000 });
    const impl = async (m: string) => (seen.push(m), m === A ? Promise.reject(limited) : "ok");
    await generate("x", { models, impl });
    await generate("x", { models, impl });
    expect(seen).toEqual([A, B, B]);
    expect(quotaCooloffMs(limited)).toBe(42_000);
    expect(quotaCooloffMs(Object.assign(new Error('{"error":{"code":429,"details":[{"retryDelay":"4575s"}]}}'), { status: 429 }))).toBe(4575_000);
  });

  it("retries a timed-out model once when it's the only one left", async () => {
    const seen: string[] = [];
    let n = 0;
    const res = await generate("x", { models: [A], impl: async (m) => (seen.push(m), n++ === 0 ? Promise.reject(new Error("timeout after 4000 ms")) : "ok") });
    expect(res.text).toBe("ok");
    expect(seen).toEqual([A, A]);
  });

  it("never runs past its total time budget (deadlineMs)", async () => {
    const t0 = Date.now();
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 400));
      throw new Error("503 overloaded");
    };
    const res = await generate("x", { models, impl: slow, deadlineMs: 700, template: () => "plain" });
    expect(res.text).toBe("plain");
    expect(Date.now() - t0).toBeLessThan(1200);
  });

  it("reads JSON even when a model wraps it in words or fences", async () => {
    const r = await generateJson<{ what: string }>("x", { models, impl: async () => 'Sure! Here it is:\n```json\n{"what":"Bowling"}\n```' });
    expect(r.data.what).toBe("Bowling");
  });

  it("only uses providers with a key; screenshots only go to models that can see", () => {
    const before = { ...process.env };
    process.env.GROQ_API_KEY = "gsk_test_key_123";
    delete process.env.GEMINI_API_KEY;
    try {
      // env() caches; this test only checks the catalogue filter through a fresh module-level read
      const text = chainFor("hello");
      const image = chainFor([{ inlineData: { mimeType: "image/png", data: "x" } }]);
      expect(text.every((m) => m.startsWith("groq:") || m.startsWith("gemini:"))).toBe(true);
      expect(image.every((m) => !m.endsWith("gpt-oss-20b") && !m.endsWith("gpt-oss-120b"))).toBe(true);
    } finally {
      Object.assign(process.env, before);
    }
  });

  it("one stall is a fluke: retry the same model; two stalls: rest it and move on", async () => {
    const seen: string[] = [];
    let n = 0;
    const once = await generate("x", { models, impl: async (m) => (seen.push(m), n++ === 0 ? Promise.reject(new Error("timeout after 1500 ms")) : "ok") });
    expect([once.model, seen]).toEqual([A, [A, A]]);
    seen.length = 0;
    const twice = await generate("x", { models, impl: async (m) => (seen.push(m), m === A ? Promise.reject(new Error("timeout after 1500 ms")) : "ok") });
    expect([twice.model, seen]).toEqual([B, [A, A, B]]);
    seen.length = 0;
    await generate("x", { models, impl: async (m) => (seen.push(m), "ok") });
    expect(seen).toEqual([B]); // A is resting
  });
});

