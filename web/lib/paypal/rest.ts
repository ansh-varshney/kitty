import { randomUUID } from "node:crypto";
import { env, PAYPAL_API_BASE } from "../env";

/**
 * Minimal PayPal REST client for the APIs the Server SDK doesn't cover
 * (Payouts, Catalog, Webhooks, Identity). Server-side only (FR-PP-3).
 * - caches the app token and refreshes it before expiry
 * - sends an idempotency key on every POST (FR-PP-1)
 * - retries 429/5xx with backoff, max 3 attempts (FR-PP-4)
 */

type Token = { value: string; expiresAt: number };
let token: Token | undefined;

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public debugId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function getAppToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (token && token.expiresAt - Date.now() > 5 * 60_000) return token.value;
  const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = env();
  const res = await fetchImpl(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new PayPalError(`PayPal token request failed`, res.status);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

export function resetTokenCache() {
  token = undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function paypalRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; requestId?: string; headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const requestId = method === "POST" ? (opts.requestId ?? randomUUID()) : undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const accessToken = await getAppToken(fetchImpl);
    const res = await fetchImpl(`${PAYPAL_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? safeJson(text) : undefined;
    if (res.ok) return json as T;
    const debugId = res.headers.get("paypal-debug-id") ?? (json as { debug_id?: string })?.debug_id;
    const name = (json as { name?: string; error?: string })?.name ?? (json as { error?: string })?.error ?? "PAYPAL_ERROR";
    lastErr = new PayPalError(`${method} ${path} → ${res.status} ${name}`, res.status, debugId, json);
    if (res.status === 401) resetTokenCache();
    const retryable = res.status === 429 || res.status >= 500 || res.status === 401;
    if (!retryable || attempt === 3) throw lastErr;
    await sleep(400 * 2 ** (attempt - 1));
  }
  throw lastErr;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
