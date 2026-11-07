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
    signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
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

/** Per attempt. The sandbox sometimes stalls (Phase 1: a 30 s hang); a stalled call is retried, never waited on forever. */
export const PAYPAL_TIMEOUT_MS = 15_000;

export async function paypalRequest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  opts: { body?: unknown; requestId?: string; headers?: Record<string, string>; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const requestId = method === "POST" ? (opts.requestId ?? randomUUID()) : undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      const accessToken = await getAppToken(fetchImpl);
      res = await fetchImpl(`${PAYPAL_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(PAYPAL_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout or dropped connection. Safe to retry: GETs read, and every POST reuses its PayPal-Request-Id,
      // so PayPal treats the retry as the same request (no double charge or payout).
      if (err instanceof PayPalError) throw err;
      lastErr = new PayPalError(`${method} ${path} → no answer (${(err as Error).name}: ${(err as Error).message})`, 0);
      if (attempt === 3 || method === "PATCH" || method === "DELETE") throw lastErr;
      await sleep(400 * 2 ** (attempt - 1));
      continue;
    }
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
