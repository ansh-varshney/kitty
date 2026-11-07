import { planShares, splitCents, type CostModel, type ShareMember } from "./shares";

/** Tag along and leftovers (PRD §B9 "Tag along", §B10, FR-POUNCE-9, FR-SETTLE-2). Pure, integer cents. */

export type Paid = { userId: string; source: "savings" | "jar" | "paypal"; cents: number };

/**
 * A newcomer joins after the Pounce. In total-price plans everyone's share drops; existing members
 * get back exactly (what they paid − their new share). The newcomer pays their new share.
 * Money balances: sum(refunds) === newcomer pays (total-price plans with an unchanged total).
 */
export function tagAlong(
  cost: CostModel,
  existing: (ShareMember & { paidCents: number })[],
  newcomer: ShareMember,
): { newcomerPays: number; refunds: Record<string, number>; newShares: Record<string, number> } {
  const all = [...existing, newcomer];
  const newShares = planShares(cost, all);
  const refunds: Record<string, number> = {};
  for (const m of existing) {
    const diff = m.paidCents - newShares[m.id];
    if (diff > 0) refunds[m.id] = diff;
  }
  return { newcomerPays: newShares[newcomer.id], refunds, newShares };
}

/**
 * Leftover after the receipt: returned in proportion to what each person paid, and within a person
 * to each source they paid from (PayPal refund, savings, Treat Jar). Sums exactly to `leftoverCents`.
 */
export function leftovers(paid: Paid[], leftoverCents: number): Paid[] {
  if (leftoverCents <= 0) return [];
  const byUser = new Map<string, Paid[]>();
  paid.forEach((p) => byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]));
  const users = [...byUser.keys()];
  const userTotals = users.map((u) => byUser.get(u)!.reduce((a, p) => a + p.cents, 0));
  const totalPaid = userTotals.reduce((a, b) => a + b, 0);
  if (leftoverCents > totalPaid) throw new Error("leftover is more than was paid");
  const perUser = splitCents(leftoverCents, userTotals);
  const out: Paid[] = [];
  users.forEach((u, i) => {
    const parts = byUser.get(u)!;
    const perSource = splitCents(perUser[i], parts.map((p) => p.cents));
    parts.forEach((p, j) => perSource[j] > 0 && out.push({ userId: u, source: p.source, cents: perSource[j] }));
  });
  return out;
}

/** Overrun (receipt above what was collected): ≤15% asks each member; above needs the host (FR-SETTLE-3). */
export function overrun(collectedCents: number, actualCents: number): { extraCents: number; needsHost: boolean } {
  const extra = Math.max(0, actualCents - collectedCents);
  return { extraCents: extra, needsHost: extra > Math.floor(collectedCents * 0.15) };
}
