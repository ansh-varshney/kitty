import { NextResponse } from "next/server";
import { authorizeHold, getSubscription } from "@/lib/spike/steps";
import { db } from "@/lib/db";

/**
 * PayPal sends the member back here after they approve.
 * kind=hold → turn the approved order into a hold; kind=sub → read the subscription status.
 * The result is stored, and the browser goes back to /dev (no personal data in the URL).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const d = await db();
  let step = "returnUnknown";
  let result: { ok: boolean; summary: string; data?: unknown };
  try {
    if (kind === "hold") {
      step = "walletHoldApproved";
      const orderId = url.searchParams.get("token") ?? "";
      const hold = await authorizeHold(orderId);
      result = { ok: hold.status === "CREATED", summary: `Hold placed: $15.00 on order ${orderId}, status ${hold.status}, expires ${hold.expiresAt}.`, data: hold };
    } else if (kind === "sub") {
      step = "subscriptionApproved";
      const id = url.searchParams.get("subscription_id") ?? "";
      const sub = await getSubscription(id);
      result = { ok: ["ACTIVE", "APPROVED"].includes(sub.status), summary: `Subscription ${sub.id} is ${sub.status}, quantity ${sub.quantity}.`, data: sub };
    } else {
      result = { ok: false, summary: "Unknown return type." };
    }
  } catch (err) {
    result = { ok: false, summary: (err as Error).message };
  }
  await d.query("insert into spike_runs (step, ok, result) values ($1, $2, $3)", [step, result.ok, JSON.stringify(result)]);
  return NextResponse.redirect(new URL(`/dev?done=${step}`, url.origin));
}
