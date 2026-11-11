import { db } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { getUser } from "./users";
import { getPlan } from "./plans";
import { paidParts } from "./pounce";
import { leftovers, overrun } from "../referee/settle";
import { readReceipt } from "../kitten/ai";
import { refundCapture, testCardPayment } from "../paypal/holds";
import { collect, refillOrAsk } from "./money-flow";
import { jarBalances } from "./month";
import { withLock } from "./locks";

/** Receipts and leftovers (PRD §B10, FR-SETTLE-1..4, AT-12). */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/** The booker adds a receipt. The kitten reads the total; nothing moves until the booker confirms (FR-SETTLE-1). */
export async function submitReceipt(bookerId: string, planId: string, input: { imageBase64?: string; mimeType?: string; cents?: number }) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.booker_id !== bookerId) throw new Error("Only the booker adds receipts.");
  if (plan.status !== "pounced") throw new Error("Receipts come after the Pounce.");
  const [pc] = await d.query<{ status: string }>(`select status from pounces where plan_id=$1 order by created_at desc limit 1`, [planId]);
  if (pc?.status === "payout_pending") throw new Error("Your payout hasn't arrived yet. Book and add the receipt after it does.");
  const done = await d.query(`select 1 from receipts where plan_id=$1 and status='confirmed' limit 1`, [planId]);
  if (done.length) throw new Error("This plan's receipt is already confirmed.");
  const read = input.imageBase64 ? await readReceipt(input.imageBase64, input.mimeType) : { totalCents: input.cents ?? null, merchant: null };
  const [r] = await d.query<{ id: string }>(`insert into receipts (plan_id, booker_id, extracted_cents) values ($1,$2,$3) returning id`, [planId, bookerId, read.totalCents]);
  await logEvent(d, { userId: bookerId, squadId: plan.squad_id, actor: "kitten", type: "receipt.read", objectType: "plan", objectId: planId, payload: { receiptId: r.id, extractedCents: read.totalCents, merchant: read.merchant, text: read.totalCents != null ? `I read ${fmt(read.totalCents)}. Is that right?` : "I couldn't read the total. Type it in?" }, reason: "you added a receipt" });
  return { receiptId: r.id, extractedCents: read.totalCents, merchant: read.merchant };
}

/**
 * The booker confirms the total. Under budget → the leftover goes back in proportion to what each person
 * paid, to each source; the booker returns everyone else's part. Over budget (≤15%) → each member is asked.
 */
export async function confirmReceipt(bookerId: string, receiptId: string, cents: number, refill?: boolean) {
  const d = await db();
  const [r0] = await d.query<{ plan_id: string }>(`select plan_id from receipts where id=$1`, [receiptId]);
  if (!r0) throw new Error("Not your receipt.");
  // One settle at a time per plan: a double tap must not refund twice.
  return withLock(`pounce:${r0.plan_id}`, () => confirmReceiptNow(bookerId, receiptId, cents, undefined, refill));
}

/** The booker's PayPal payment of the leftover arrived: now everyone can be paid back (FR-SHOW-2). */
export async function finishLeftover(receiptId: string, cents: number, captureId: string | null) {
  const d = await db();
  const [r] = await d.query<{ plan_id: string; booker_id: string }>(`select plan_id, booker_id from receipts where id=$1`, [receiptId]);
  if (!r) throw new Error("No such receipt.");
  return withLock(`pounce:${r.plan_id}`, () => confirmReceiptNow(r.booker_id, receiptId, cents, { captureId }));
}

async function confirmReceiptNow(bookerId: string, receiptId: string, cents: number, paidBack?: { captureId: string | null }, refill?: boolean) {
  const d = await db();
  const [r] = await d.query<{ plan_id: string; booker_id: string; status: string }>(`select plan_id, booker_id, status from receipts where id=$1`, [receiptId]);
  if (!r || r.booker_id !== bookerId) throw new Error("Not your receipt.");
  if (r.status === "confirmed") throw new Error("Already confirmed.");
  const plan = await getPlan(d, r.plan_id);
  if (plan.status !== "pounced") throw new Error("This plan is already settled.");
  const other = await d.query(`select 1 from receipts where plan_id=$1 and status='confirmed' and id<>$2 limit 1`, [plan.id, receiptId]);
  if (other.length) throw new Error("This plan's receipt is already confirmed.");
  const [pounce] = await d.query<{ group_ids: string[]; total_cents: number }>(`select group_ids, total_cents from pounces where plan_id=$1 order by created_at desc limit 1`, [plan.id]);
  const collected = pounce.total_cents; // what the booker received (tag-alongs refund others, not the booker)
  const [squad] = await d.query<{ leftovers_to_savings: boolean }>(`select leftovers_to_savings from squads where id=$1`, [plan.squad_id]);

  if (cents < collected) {
    const leftover = collected - cents;
    const paid = (await Promise.all(pounce.group_ids.map((u) => paidParts(d, plan.id, u)))).flat();
    const parts = leftovers(paid, leftover);
    const bookerPart = parts.filter((p) => p.userId === bookerId).reduce((a, p) => a + p.cents, 0);
    const returnCents = leftover - bookerPart;
    const booker = await getUser(d, bookerId);
    // The money went to the booker's PayPal at the Pounce, so a real booker sends the rest back, from their Treat Jar.
    const fromJar = !paidBack && !booker?.is_demo && returnCents > 0;
    if (fromJar) {
      const { availableCents } = await jarBalances(d, bookerId);
      if (availableCents < returnCents) return refillOrAsk(bookerId, returnCents - availableCents, availableCents, { refill, after: `leftover:${receiptId}:${cents}`, reason: `leftover from ${plan.title}` });
    }
    const back = paidBack ?? (returnCents > 0 && !fromJar ? await testCardPayment({ cents: returnCents, customId: `leftover:${plan.id.slice(0, 8)}` }) : null);

    const done: { userId: string; source: string; cents: number; refundId?: string; captureId?: string }[] = [];
    for (const p of parts.filter((x) => x.userId !== bookerId)) {
      if (squad.leftovers_to_savings) done.push({ userId: p.userId, source: "savings", cents: p.cents });
      else if (p.source === "paypal") {
        const [cap] = await d.query<{ capture_id: string }>(`select capture_id from paws where plan_id=$1 and user_id=$2 and source='paypal' and status='captured' and kind <> 'cover' order by captured_cents desc limit 1`, [plan.id, p.userId]);
        const ref = await refundCapture(cap.capture_id, p.cents);
        done.push({ userId: p.userId, source: "paypal", cents: p.cents, refundId: ref.refundId, captureId: cap.capture_id });
      } else done.push({ userId: p.userId, source: p.source, cents: p.cents });
    }
    await d.tx(async (q) => {
      if (fromJar) await move(q, acct.jar(bookerId), acct.plan(plan.id), returnCents, { kind: "leftover_return", userId: bookerId, planId: plan.id, reason: "you returned everyone else's leftover, from your Treat Jar" });
      if (back) await move(q, acct.world, acct.plan(plan.id), returnCents, { kind: "leftover_return", userId: bookerId, planId: plan.id, paypalId: back.captureId, reason: "the booker returned everyone else's leftover" });
      // The booker keeps their own part (it's already in their PayPal from the payout). Record it as a refund
      // so their month and their net paid (used by later tag-alongs) are right.
      for (const bp of parts.filter((x) => x.userId === bookerId)) {
        await move(q, acct.world, acct.plan(plan.id), bp.cents, { kind: "leftover_return", userId: bookerId, planId: plan.id, reason: "your own leftover (kept)" });
        await move(q, acct.plan(plan.id), acct.world, bp.cents, { kind: "refund", userId: bookerId, planId: plan.id, reason: "your own leftover (kept)" });
        await q.query(`insert into refunds (plan_id, user_id, cents, source, reason) values ($1,$2,$3,$4,'leftover_kept')`, [plan.id, bookerId, bp.cents, bp.source]);
      }
      for (const x of done) {
        const to = x.source === "paypal" ? acct.world : x.source === "jar" ? acct.jar(x.userId) : acct.savings(plan.squad_id, x.userId);
        await move(q, acct.plan(plan.id), to, x.cents, { kind: "refund", userId: x.userId, planId: plan.id, paypalId: x.refundId, reason: "leftover after the receipt" });
        await q.query(`insert into refunds (plan_id, user_id, cents, source, paypal_refund_id, capture_id, reason) values ($1,$2,$3,$4,$5,$6,'leftover')`, [plan.id, x.userId, x.cents, x.source, x.refundId ?? null, x.captureId ?? null]);
        await logEvent(q, { userId: x.userId, squadId: plan.squad_id, actor: "system", type: "leftover.refund", objectType: "plan", objectId: plan.id, payload: { cents: x.cents, source: x.source, text: `${fmt(x.cents)} back to your ${x.source === "paypal" ? "PayPal" : x.source === "jar" ? "Treat Jar" : "savings"}.` }, paypalId: x.refundId ?? null });
      }
      await q.query(`update receipts set confirmed_cents=$2, status='confirmed', leftover_cents=$3 where id=$1`, [receiptId, cents, leftover]);
      await q.query(`update plans set status='settled' where id=$1`, [plan.id]);
      await q.query(`update squads set archived_at=now() where id=$1 and kind='mini'`, [plan.squad_id]);
      await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "plan.settled", objectType: "plan", objectId: plan.id, public: { text: `${plan.title} came in under budget. Leftovers went back to everyone.` } });
    });
    return { kind: "leftover" as const, leftoverCents: leftover, bookerReturnedCents: returnCents, refunds: done };
  }

  if (cents > collected) {
    const o = overrun(collected, cents);
    const [pounce2] = await d.query<{ shares: Record<string, number> }>(`select shares from pounces where plan_id=$1 order by created_at desc limit 1`, [plan.id]);
    const ids = Object.keys(pounce2.shares);
    const { splitCents } = await import("../referee/shares");
    const parts = splitCents(o.extraCents, ids.map((id) => pounce2.shares[id]));
    await d.tx(async (q) => {
      await q.query(`update receipts set confirmed_cents=$2, status='confirmed', extra_cents=$3 where id=$1`, [receiptId, cents, o.extraCents]);
      for (let i = 0; i < ids.length; i++) {
        await q.query(`update plan_members set overrun_due_cents=$3, overrun_paid=false where plan_id=$1 and user_id=$2`, [plan.id, ids[i], parts[i]]);
        await logEvent(q, { userId: ids[i], squadId: plan.squad_id, actor: "kitten", type: "overrun.asked", objectType: "plan", objectId: plan.id, payload: { cents: parts[i], needsHost: o.needsHost, text: `It came to a bit more. Your part: ${fmt(parts[i])}.` } });
      }
    });
    return { kind: "overrun" as const, extraCents: o.extraCents, needsHost: o.needsHost };
  }

  await d.query(`update receipts set confirmed_cents=$2, status='confirmed' where id=$1`, [receiptId, cents]);
  await d.query(`update plans set status='settled' where id=$1`, [plan.id]);
  await d.query(`update squads set archived_at=now() where id=$1 and kind='mini'`, [plan.squad_id]);
  return { kind: "exact" as const };
}

/** A member pays their part of an overrun; when everyone has, the booker is paid the extra (FR-SETTLE-3). */
export async function payOverrun(userId: string, planId: string, refill?: boolean) {
  return withLock(`overrun:${planId}:${userId}`, () => payOverrunNow(userId, planId, refill));
}

async function payOverrunNow(userId: string, planId: string, refill?: boolean) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "pounced") throw new Error("Nothing to pay: this plan is settled.");
  const [m] = await d.query<{ overrun_due_cents: number; overrun_paid: boolean }>(`select overrun_due_cents, overrun_paid from plan_members where plan_id=$1 and user_id=$2`, [planId, userId]);
  if (!m || m.overrun_paid || m.overrun_due_cents <= 0) throw new Error("Nothing to pay.");
  // From the Treat Jar, with a refill if it's short (§B10, FR-JAR-7).
  const c = await collect(userId, m.overrun_due_cents, acct.plan(planId), { ledgerKind: "overrun", reason: `your part of the extra cost for ${plan.title}`, after: `overrun:${planId}`, planId, refill });
  if (!c.done) return c.next;
  return finishOverrun(planId, userId);
}

/** Their part arrived (Treat Jar, or back from PayPal). */
async function finishOverrun(planId: string, userId: string) {
  const d = await db();
  await d.query(`update plan_members set overrun_paid=true where plan_id=$1 and user_id=$2`, [planId, userId]);
  const bookerPaid = await payOverrunToBooker(planId);
  return { paid: true, bookerPaid };
}

/** Back from PayPal with a real user's part of an extra cost. */
export async function finishOverrunPayment(planId: string, userId: string, cents: number, captureId: string | null) {
  return withLock(`overrun:${planId}:${userId}`, async () => {
    const d = await db();
    const [m] = await d.query<{ overrun_paid: boolean }>(`select overrun_paid from plan_members where plan_id=$1 and user_id=$2`, [planId, userId]);
    if (!m || m.overrun_paid) return { paid: true, bookerPaid: false };
    await d.tx((q) => move(q, acct.world, acct.plan(planId), cents, { kind: "overrun", userId, planId, paypalId: captureId, reason: "your part of the extra cost" }));
    return finishOverrun(planId, userId);
  });
}

/**
 * When every share of an overrun is in, pay the booker the extra. A failed payout (or no PayPal email yet) leaves the
 * money in the plan's pot and the timer tries again (retryPendingPayouts), instead of failing after members paid.
 */
export async function payOverrunToBooker(planId: string) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "pounced") return false;
  const [left] = await d.query<{ n: number }>(`select count(*)::int as n from plan_members where plan_id=$1 and overrun_due_cents>0 and not overrun_paid`, [planId]);
  const [{ c }] = await d.query<{ c: string }>(`select coalesce(sum(overrun_due_cents),0) as c from plan_members where plan_id=$1`, [planId]);
  if (left.n > 0 || Number(c) <= 0) return false;
  return d.tx(async (q) => {
    await move(q, acct.plan(planId), acct.jar(plan.booker_id), Number(c), { kind: "pot_to_booker", userId: plan.booker_id, planId, reason: `the extra for ${plan.title}` });
    await q.query(`update plans set status='settled' where id=$1`, [planId]);
    await logEvent(q, { userId: plan.booker_id, squadId: plan.squad_id, actor: "system", type: "overrun.paid", objectType: "plan", objectId: planId, payload: { cents: Number(c), text: `Everyone's part of the extra for "${plan.title}" (${fmt(Number(c))}) is in your Treat Jar.` } });
    return true;
  });
}
