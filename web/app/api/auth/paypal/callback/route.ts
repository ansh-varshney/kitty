import { NextResponse } from "next/server";
import { exchangeCode } from "@/lib/paypal/login";
import { db } from "@/lib/db";

/** Log in with PayPal callback (FR-ONB-1). Phase 0 only checks it works; sessions come in Phase 1. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const d = await db();
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
