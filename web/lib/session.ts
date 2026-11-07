import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { devAllowed } from "./dev-auth";

/**
 * Signed session cookie (PRD §D8 Phase 1: sessions). Value = base64url(userId).signature.
 * The signing key is derived from the app's PayPal secret, so no extra setting is needed on Render.
 * The dev console may "act as" a demo user with the dev key (x-dev-key + x-act-as).
 */

export const SESSION_COOKIE = "kitty_session";
/** Holds the Log in with PayPal `state` for 10 minutes (CSRF check on the way back). */
export const OAUTH_COOKIE = "kitty_oauth";

function key() {
  return createHmac("sha256", env().PAYPAL_CLIENT_SECRET).update("kitty-session-v1").digest();
}

export function signSession(userId: string): string {
  const id = Buffer.from(userId).toString("base64url");
  const sig = createHmac("sha256", key()).update(id).digest("base64url");
  return `${id}.${sig}`;
}

export function verifySession(value: string | undefined | null): string | null {
  if (!value) return null;
  const [id, sig] = value.split(".");
  if (!id || !sig) return null;
  const expected = createHmac("sha256", key()).update(id).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return Buffer.from(id, "base64url").toString();
}

export function sessionCookieHeader(userId: string): string {
  return `${SESSION_COOKIE}=${signSession(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

/** The acting user for a request: dev console "act as" (dev key) or the signed cookie. */
export function requestUserId(req: Request): string | null {
  const actAs = req.headers.get("x-act-as");
  if (actAs && devAllowed(req)) return actAs;
  return verifySession(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export { readCookie };
