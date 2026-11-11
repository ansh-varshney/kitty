import type { Queryable } from "../db";
import { db } from "../db";
import { acct, move } from "./ledger";
import { getUser, listRules } from "./users";
import { jarBalances } from "./month";
import { decide, type MoneyAction } from "../referee/rules";
import { createCheckout, testCardPayment } from "../paypal/holds";
import { sendPayout } from "../paypal/payouts";
import { baseUrl } from "../env";

/**
 * Money in and money out for friends' money (Yarn, Nine Lives, extra costs, tag along). Every payment comes from the
 * Treat Jar (FR-JAR-7). If it's short, a person is asked to refill it for the difference: that refill is the only
 * PayPal payment anyone ever approves. Demo friends can't approve anything, so they use the sandbox test card.
 */

export type JarShort = { ok: false; code: "jar_short"; shortCents: number; jarCents: number };
export type Refill = { ok: true; approveUrl: string };

export type Collected =
  | { done: true; source: "jar" | "paypal"; paypalId: string | null }
  | { done: false; next: JarShort | Refill };

/**
 * The jar is short. First the app is told, so it can ask. Once they've said yes (`refill`), PayPal opens for just the
 * difference. `after` is what to finish when they come back (see the return/jar route).
 */
export async function refillOrAsk(userId: string, shortCents: number, jarCents: number, opts: { refill?: boolean; after: string; reason: string }): Promise<JarShort | Refill> {
  if (!opts.refill) return { ok: false, code: "jar_short", shortCents, jarCents };
  const base = baseUrl();
  const { approveUrl } = await createCheckout({
    cents: shortCents,
    customId: `jar:${userId}|${opts.after}`,
    description: `Kitty Treat Jar refill: ${opts.reason}`.slice(0, 120),
    returnUrl: `${base}/api/v1/return/jar`,
    cancelUrl: `${base}/?cancelled=jar`,
  });
  return { ok: true, approveUrl };
}

/** Pays from the Treat Jar if the kitten may do it alone (within free hand, enough in the jar). Otherwise does nothing. */
export async function payFromJar(userId: string, cents: number, to: string, opts: { kind: MoneyAction["kind"]; squadId?: string | null; ledgerKind: string; reason: string; planId?: string | null }): Promise<boolean> {
  const d = await db();
  const rules = (await listRules(d, userId)).filter((r) => r.type !== "R1"); // settling isn't new spending
  const jar = await jarBalances(d, userId);
  const dec = decide({ kind: opts.kind, cents, source: "jar", squadId: opts.squadId }, { rules, jarAvailableCents: jar.availableCents, monthSpentCents: 0, monthCommittedCents: 0 });
  if (dec.mode !== "auto") return false;
  await d.tx((q) => move(q, acct.jar(userId), to, cents, { kind: opts.ledgerKind, userId, planId: opts.planId ?? null, reason: `${opts.reason} (Treat Jar, within your free hand)` }));
  return true;
}

export async function collect(
  userId: string,
  cents: number,
  to: string,
  opts: { ledgerKind: string; jarKind?: string; reason: string; after: string; planId?: string | null; refill?: boolean },
): Promise<Collected> {
  if (!Number.isInteger(cents) || cents <= 0) throw new Error("Pick an amount.");
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  // They tapped Pay, so the jar pays whatever the amount. The free hand only limits what the kitten does alone (payFromJar).
  const { availableCents } = await jarBalances(d, userId);
  if (availableCents >= cents) {
    await d.tx((q) => move(q, acct.jar(userId), to, cents, { kind: opts.jarKind ?? opts.ledgerKind, userId, planId: opts.planId ?? null, reason: `${opts.reason} (Treat Jar)` }));
    return { done: true, source: "jar", paypalId: null };
  }
  if (user.is_demo) {
    const pay = await testCardPayment({ cents, customId: opts.after.slice(0, 120) });
    await d.tx((q) => move(q, acct.world, to, cents, { kind: opts.ledgerKind, userId, planId: opts.planId ?? null, paypalId: pay.captureId, reason: opts.reason }));
    return { done: true, source: "paypal", paypalId: pay.captureId ?? null };
  }
  return { done: false, next: await refillOrAsk(userId, cents - availableCents, availableCents, opts) };
}

/**
 * Pay a member from a Kitty account by PayPal Payout. The money leaves the account FIRST (so a second tap finds it
 * gone, and an overdraw is refused by the ledger), then the payout is sent; if PayPal fails, the money goes back and
 * this returns null so the caller (or the timer) can retry. No PayPal email yet → null too: nothing is lost, it waits.
 */
export async function payOut(
  q: Queryable,
  userId: string,
  cents: number,
  from: string,
  meta: { note: string; itemId: string; kind?: string; planId?: string | null },
): Promise<string | null> {
  const user = await getUser(q, userId);
  if (!user?.paypal_email) {
    console.error(`[payout] ${meta.note}: no PayPal email yet; the money waits in ${from.split(":")[0]}`);
    return null;
  }
  const kind = meta.kind ?? "payout";
  const txn = await move(q, from, acct.world, cents, { kind, userId, planId: meta.planId ?? null, reason: meta.note });
  try {
    const sent = await sendPayout([{ email: user.paypal_email, cents, note: meta.note.slice(0, 120), itemId: meta.itemId.slice(0, 60) }], `Kitty: ${meta.note}`.slice(0, 120));
    await q.query(`update ledger set paypal_id=$2 where txn=$1`, [txn, sent.batchId]);
    return sent.batchId;
  } catch (e) {
    console.error(`[payout] ${meta.note}: ${(e as Error).message}`);
    await move(q, acct.world, from, cents, { kind: `${kind}_failed`, userId, planId: meta.planId ?? null, reason: `${meta.note} (PayPal didn't send it; back where it was)` });
    return null;
  }
}
