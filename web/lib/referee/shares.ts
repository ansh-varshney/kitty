/**
 * Shares (PRD §B8, §B9 rounding, FR-POUNCE-6). Integer cents, largest-remainder split.
 * Ties for the extra cent go to the earliest paw (lowest `order`).
 */

export type CostModel = {
  priceMode: "total" | "per_person";
  priceCents: number;
  splitMode: "equal" | "custom" | "weights";
};

export type ShareMember = { id: string; order: number; weight?: number; customCents?: number | null };

/** Split `total` cents by weights; result sums to exactly `total`. */
export function splitCents(total: number, weights: number[], order?: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error(`total must be non-negative integer cents: ${total}`);
  if (weights.length === 0) return [];
  const w = weights.map((x) => (x > 0 ? x : 0));
  const sumW = w.reduce((a, b) => a + b, 0);
  if (sumW === 0) throw new Error("weights sum to zero");
  const exact = w.map((x) => (total * x) / sumW);
  const base = exact.map(Math.floor);
  let left = total - base.reduce((a, b) => a + b, 0);
  const ord = order ?? weights.map((_, i) => i);
  const idx = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x), ord: ord[i] }))
    .sort((a, b) => b.frac - a.frac || a.ord - b.ord);
  for (const { i } of idx) {
    if (left <= 0) break;
    base[i] += 1;
    left -= 1;
  }
  return base;
}

/** Each member's share for a given group (PRD §B8 "Per-person share"). */
export function planShares(cost: CostModel, members: ShareMember[]): Record<string, number> {
  const sorted = [...members].sort((a, b) => a.order - b.order);
  const out: Record<string, number> = {};
  if (sorted.length === 0) return out;

  if (cost.priceMode === "per_person") {
    for (const m of sorted) out[m.id] = cost.splitMode === "custom" && m.customCents != null ? m.customCents : cost.priceCents;
    return out;
  }

  if (cost.splitMode === "custom") {
    const fixed = sorted.filter((m) => m.customCents != null);
    const rest = sorted.filter((m) => m.customCents == null);
    const fixedSum = fixed.reduce((a, m) => a + (m.customCents ?? 0), 0);
    const remaining = cost.priceCents - fixedSum;
    if (remaining < 0) throw new Error("custom amounts exceed the total price");
    for (const m of fixed) out[m.id] = m.customCents!;
    if (rest.length) {
      const parts = splitCents(remaining, rest.map(() => 1), rest.map((m) => m.order));
      rest.forEach((m, i) => (out[m.id] = parts[i]));
    } else if (remaining > 0) {
      throw new Error("custom amounts don't add up to the total price");
    }
    return out;
  }

  const weights = sorted.map((m) => (cost.splitMode === "weights" ? (m.weight ?? 1) : 1));
  const parts = splitCents(cost.priceCents, weights, sorted.map((m) => m.order));
  sorted.forEach((m, i) => (out[m.id] = parts[i]));
  return out;
}

/** Share ladder shown at paw-in: "If 4 go: $175 · 5: $140 · 6: $117" (FR-PLAN-4). Equal-share estimate. */
export function shareLadder(cost: CostModel, sizes: number[]): { size: number; perPersonCents: number }[] {
  return sizes
    .filter((n) => n > 0)
    .map((n) => ({
      size: n,
      perPersonCents: cost.priceMode === "per_person" ? cost.priceCents : Math.ceil(cost.priceCents / n),
    }));
}

/**
 * The share a person should expect to pay (owner request, 7 Nov): split across the LARGER of "need at least" and the
 * number who would be in (the viewer counts if they join). Need 3, 2 in → the third sees cost/3; 4 in → the fifth
 * sees cost/5. Custom amounts and weights are respected; empty "need at least" seats count as weight 1.
 */
export function expectedShare(
  cost: CostModel,
  opts: { needAtLeast: number; inMembers: ShareMember[]; viewer: ShareMember; viewerIn: boolean },
): { cents: number; splitWays: number; basis: "need" | "in" } {
  const group = opts.viewerIn ? [...opts.inMembers] : [...opts.inMembers, { ...opts.viewer, order: Math.max(0, ...opts.inMembers.map((m) => m.order)) + 1 }];
  const splitWays = Math.max(opts.needAtLeast, group.length);
  const seats = [...group];
  for (let i = group.length; i < splitWays; i++) seats.push({ id: `seat-${i}`, order: 10_000 + i });
  const shares = planShares(cost, seats);
  return { cents: shares[opts.viewer.id] ?? 0, splitWays, basis: group.length <= opts.needAtLeast ? "need" : "in" };
}
