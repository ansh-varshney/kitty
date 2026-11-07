import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/paypal/login";
import { db } from "@/lib/db";
import { OAUTH_COOKIE, readCookie, sessionCookieHeader } from "@/lib/session";
import { upsertPayPalUser } from "@/lib/core/users";

/**
 * Log in with PayPal callback (FR-ONB-1).
 * - App login (started at /api/v1/auth/login): state matches the kitty_oauth cookie → find or create the
 *   user, set the session cookie, go to the app.
 * - Otherwise it's the Phase 0 dev-console check: record the result and go back to /dev.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = readCookie(req.headers.get("cookie"), OAUTH_COOKIE);
  const d = await db();

  if (state && expected && state === expected) {
    const clear = `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    if (!code) {
      const res = NextResponse.redirect(new URL(`/?login=cancelled`, url.origin), 303);
      res.headers.append("set-cookie", clear);
      return res;
    }
    try {
      const p = await exchangeCode(code);
      if (!p.payerId) throw new Error("PayPal didn't say who you are.");
      const user = await upsertPayPalUser(d, p);
      const res = NextResponse.redirect(new URL(user.onboarded ? `/?login=done` : `/?login=new`, url.origin), 303);
      res.headers.append("set-cookie", sessionCookieHeader(user.id));
      res.headers.append("set-cookie", clear);
      return res;
    } catch (err) {
      console.error("[login]", (err as Error).message);
      const res = NextResponse.redirect(new URL(`/?login=failed`, url.origin), 303);
      res.headers.append("set-cookie", clear);
      return res;
    }
  }

  let result: { ok: boolean; summary: string; data?: unknown };
  if (!code) {
    result = { ok: false, summary: `PayPal returned no code (${url.searchParams.get("error") ?? "cancelled"}).` };
  } else {
    try {
      const user = await exchangeCode(code);
      result = {
        ok: Boolean(user.payerId),
        summary: `Logged in as ${user.name ?? "(no name)"}; email ${user.email ? "received" : "missing"}${user.emailVerified ? " and verified" : ""}.`,
        data: { payerId: user.payerId, hasEmail: Boolean(user.email), emailVerified: user.emailVerified },
      };
    } catch (err) {
      result = { ok: false, summary: (err as Error).message };
    }
  }
  await d.query("insert into spike_runs (step, ok, result) values ($1, $2, $3)", ["loginReturned", result.ok, JSON.stringify(result)]);
  return NextResponse.redirect(new URL(`/dev?done=loginReturned`, url.origin));
}
