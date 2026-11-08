import { db, type Queryable } from "../db";
import { acct, balance, move } from "./ledger";
import { logEvent } from "./events";
import { getUser } from "./users";
import { captureCheckout, createCheckout, testCardPayment } from "../paypal/holds";
import { sendPayout } from "../paypal/payouts";
import { baseUrl } from "../env";
import { withLock } from "./locks";

/** Treat Jar: the kitten's allowance (PRD §B4, FR-JAR-1..6). Real money moves at top-up and withdrawal. */

export async function startTopUp(userId: string, cents: number): Promise<{ done: true; captureId?: string } | { done: false; approveUrl: string }> {
  if (!Number.isInteger(cents) || cents <= 0 || cents > 50_000) throw new Error("Top up between $0.01 and $500.");
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  if (user.is_demo) {
    const pay = await testCardPayment({ cents, customId: `jar:${userId}` });
    await d.tx(async (q) => {
      await move(q, acct.world, acct.jar(userId), cents, { kind: "jar_topup", userId, paypalId: pay.captureId, reason: "Treat Jar top-up" });
      await logEvent(q, { userId, actor: "user", actorId: userId, type: "jar.topped_up", payload: { cents }, paypalId: pay.captureId, reason: "you topped up your Treat Jar" });
    });
    return { done: true, captureId: pay.captureId };
  }
  const base = baseUrl();
  const { approveUrl } = await createCheckout({
    cents,
    customId: `jar:${userId}`,
    description: "Kitty Treat Jar top-up (sandbox)",
    returnUrl: `${base}/api/v1/return/jar`,
    cancelUrl: `${base}/?cancelled=jar`,
  });
  return { done: false, approveUrl };
}

/** PayPal sends the user back here after approving a top-up. */
export async function finishTopUp(orderId: string): Promise<{ userId: string; cents: number }> {
  const cap = await captureCheckout(orderId);
  const userId = (cap.customId ?? "").replace(/^jar:/, "");
  if (!userId || cap.status !== "COMPLETED") throw new Error(`Top-up not completed (${cap.status})`);
  const d = await db();
  await d.tx(async (q) => {
    const seen = await q.query(`select 1 from ledger where paypal_id=$1 limit 1`, [cap.captureId]);
    if (seen.length) return; // idempotent: a refresh of the return page doesn't double-credit
    await move(q, acct.world, acct.jar(userId), cap.cents, { kind: "jar_topup", userId, paypalId: cap.captureId, reason: "Treat Jar top-up" });
    await logEvent(q, { userId, actor: "user", actorId: userId, type: "jar.topped_up", payload: { cents: cap.cents }, paypalId: cap.captureId, reason: "you topped up your Treat Jar" });
  });
  return { userId, cents: cap.cents };
}

/** Withdraw (FR-JAR-2). One at a time per person; the money leaves the jar before the payout, and comes back if PayPal fails. */
export async function withdraw(userId: string, cents: number) {
  return withLock(`jar:${userId}`, async () => {
    const d = await db();
    const user = await getUser(d, userId);
    if (!user?.paypal_email) throw new Error("Add your PayPal email first.");
    const available = await balance(d, acct.jar(userId));
    if (cents <= 0 || cents > available) throw new Error("You can only withdraw what's available in your Treat Jar.");
    const txn = await d.tx((q) => move(q, acct.jar(userId), acct.world, cents, { kind: "jar_withdraw", userId, reason: "Treat Jar withdrawal" }));
    let sent: { batchId: string };
    try {
      sent = await sendPayout([{ email: user.paypal_email, cents, note: "Kitty Treat Jar withdrawal", itemId: `jar-${userId.slice(0, 8)}` }], "Your Kitty Treat Jar");
    } catch (e) {
      await d.tx((q) => move(q, acct.world, acct.jar(userId), cents, { kind: "jar_withdraw_failed", userId, reason: "PayPal didn't send it; back in your Treat Jar" }));
      throw new Error(`PayPal couldn't send the money just now, so it's still in your Treat Jar. (${(e as Error).message.slice(0, 80)})`);
    }
    await d.tx(async (q) => {
      await q.query(`update ledger set paypal_id=$2 where txn=$1`, [txn, sent.batchId]);
      await logEvent(q, { userId, actor: "user", actorId: userId, type: "jar.withdrawn", payload: { cents }, paypalId: sent.batchId });
    });
    return sent;
  });
}

export async function reserveJar(q: Queryable, userId: string, cents: number, planId: string, reason: string) {
  const available = await balance(q, acct.jar(userId));
  if (cents > available) throw new Error("Not enough in the Treat Jar");
  await move(q, acct.jar(userId), acct.jarHeld(userId), cents, { kind: "jar_reserve", userId, planId, reason });
}
