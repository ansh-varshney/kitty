import { db, type Queryable } from "../db";
import { acct, balance, move } from "./ledger";
import { logEvent } from "./events";
import { getUser } from "./users";
import { captureCheckout, createCheckout, testCardPayment } from "../paypal/holds";
import { sendPayout } from "../paypal/payouts";
import { baseUrl } from "../env";
import { withLock } from "./locks";
import { saveDueFor } from "./party";
import { payDueFor } from "./bowl";
import { chipInWaiting, tagWaiting } from "./pounce";
import { getPlan } from "./plans";

/** A top-up may be exactly what a plan's share or a Kitty Party saving was waiting for. It never fails the top-up itself. */
const saveWhatWaited = async (userId: string) => {
  await chipInWaiting(userId).catch((e) => console.error(`[jar] shares after top-up: ${(e as Error).message}`));
  await tagWaiting(userId).catch((e) => console.error(`[jar] tag along after top-up: ${(e as Error).message}`));
  await saveDueFor(userId).catch((e) => console.error(`[jar] saving after top-up: ${(e as Error).message}`));
  await payDueFor(userId).catch((e) => console.error(`[jar] Bowl share after top-up: ${(e as Error).message}`));
};

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
    await saveWhatWaited(userId);
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
export async function finishTopUp(orderId: string): Promise<{ userId: string; cents: number; after: string | null; fresh: boolean }> {
  const cap = await captureCheckout(orderId);
  // "jar:<user>" or, for a refill made for a payment, "jar:<user>|<what to finish>".
  const [who, after] = (cap.customId ?? "").split("|");
  const userId = who.replace(/^jar:/, "");
  if (!userId || cap.status !== "COMPLETED") throw new Error(`Top-up not completed (${cap.status})`);
  const d = await db();
  const fresh = await d.tx(async (q) => {
    const seen = await q.query(`select 1 from ledger where paypal_id=$1 limit 1`, [cap.captureId]);
    if (seen.length) return false; // idempotent: a refresh of the return page doesn't double-credit
    await move(q, acct.world, acct.jar(userId), cap.cents, { kind: "jar_topup", userId, paypalId: cap.captureId, reason: "Treat Jar top-up" });
    await logEvent(q, { userId, actor: "user", actorId: userId, type: "jar.topped_up", payload: { cents: cap.cents }, paypalId: cap.captureId, reason: "you topped up your Treat Jar" });
    return true;
  });
  await saveWhatWaited(userId);
  return { userId, cents: cap.cents, after: after ?? null, fresh };
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

/**
 * The booker pays for the booking straight from their Treat Jar, to anyone with a PayPal account (FR-POUNCE-13).
 * A checkout page or a card machine can't take a Treat Jar: for those they withdraw to their own PayPal instead.
 */
/** What this plan's booking comes to, what the booker has paid from their Treat Jar, and what's left (FR-POUNCE-13). */
export async function bookingState(q: Queryable, planId: string) {
  const [pounced] = await q.query<{ total_cents: number }>(`select total_cents from pounces where plan_id=$1 order by created_at desc limit 1`, [planId]);
  if (!pounced) return null;
  const [receipt] = await q.query<{ confirmed_cents: number }>(`select confirmed_cents from receipts where plan_id=$1 and status='confirmed' order by created_at desc limit 1`, [planId]);
  // A payment PayPal refused is reversed by booking_paid_failed, so this is only what really went out.
  const [{ c }] = await q.query<{ c: number }>(`select coalesce(sum(amount_cents),0)::int as c from ledger where plan_id=$1 and account='world' and kind in ('booking_paid','booking_paid_failed')`, [planId]);
  const dueCents = receipt?.confirmed_cents ?? pounced.total_cents;
  const [plan] = await q.query<{ booked_elsewhere_at: string | null }>(`select booked_elsewhere_at from plans where id=$1`, [planId]);
  const elsewhere = Boolean(plan?.booked_elsewhere_at);
  return { dueCents, paidCents: c, remainingCents: elsewhere ? 0 : Math.max(dueCents - c, 0), elsewhere };
}

/** "I paid another way": a website checkout or a card machine. It counts as paid, and the next step is the receipt. */
export async function markPaidElsewhere(userId: string, planId: string) {
  return withLock(`jar:${userId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.booker_id !== userId) throw new Error("Only the person booking can do this.");
    if (plan.status !== "pounced") throw new Error("It has to be final before it can be paid for.");
    const booking = await bookingState(d, planId);
    if (booking && booking.remainingCents <= 0) throw new Error("This has already been paid for.");
    const left = await balance(d, acct.jar(userId));
    await d.tx(async (q) => {
      await q.query(`update plans set booked_elsewhere_at=now() where id=$1`, [planId]);
      await logEvent(q, { userId, squadId: plan.squad_id, actor: "user", actorId: userId, type: "booking.paid_elsewhere", objectType: "plan", objectId: planId, payload: { text: `You paid for "${plan.title}" another way. Everyone's money stays in your Treat Jar (${`$${(left / 100).toFixed(2)}`} there now), so you can take it out to your PayPal. Add the receipt when you have it.` } });
    });
    return { ok: true, message: "Got it. Add the receipt when you have it." };
  });
}

export async function payBooking(userId: string, planId: string, input: { email: string; cents: number }) {
  return withLock(`jar:${userId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.booker_id !== userId) throw new Error("Only the person booking can do this.");
    if (!["pounced", "settled"].includes(plan.status)) throw new Error("It has to be final before it can be paid for.");
    const available = await balance(d, acct.jar(userId));
    if (input.cents <= 0 || input.cents > available) throw new Error("You can only pay what's in your Treat Jar.");
    const booking = await bookingState(d, planId);
    if (booking && booking.remainingCents <= 0) throw new Error("This has already been paid for.");
    if (booking && input.cents > booking.remainingCents) throw new Error(`Only $${(booking.remainingCents / 100).toFixed(2)} is left to pay for this.`);
    const fmt = `$${(input.cents / 100).toFixed(2)}`;
    const txn = await d.tx((q) => move(q, acct.jar(userId), acct.world, input.cents, { kind: "booking_paid", userId, planId, reason: `paying for ${plan.title}` }));
    let sent: { batchId: string };
    try {
      sent = await sendPayout([{ email: input.email, cents: input.cents, note: `Kitty: ${plan.title}`.slice(0, 120), itemId: `book-${planId.slice(0, 8)}-${Date.now().toString(36)}` }], `Payment for ${plan.title}`.slice(0, 120));
    } catch (e) {
      await d.tx((q) => move(q, acct.world, acct.jar(userId), input.cents, { kind: "booking_paid_failed", userId, planId, reason: "PayPal didn't send it; back in your Treat Jar" }));
      throw new Error(`PayPal couldn't send it just now, so it's still in your Treat Jar. (${(e as Error).message.slice(0, 80)})`);
    }
    await d.tx(async (q) => {
      await q.query(`update ledger set paypal_id=$2 where txn=$1`, [txn, sent.batchId]);
      await logEvent(q, { userId, squadId: plan.squad_id, actor: "user", actorId: userId, type: "booking.paid", objectType: "plan", objectId: planId, payload: { cents: input.cents, text: `Paid ${fmt} to ${input.email} for "${plan.title}", from your Treat Jar.` }, paypalId: sent.batchId });
    });
    return { ok: true, batchId: sent.batchId, message: `Paid ${fmt}.` };
  });
}

export async function reserveJar(q: Queryable, userId: string, cents: number, planId: string, reason: string) {
  const available = await balance(q, acct.jar(userId));
  if (cents > available) throw new Error("Not enough in the Treat Jar");
  await move(q, acct.jar(userId), acct.jarHeld(userId), cents, { kind: "jar_reserve", userId, planId, reason });
}
