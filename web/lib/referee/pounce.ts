import { planShares, type CostModel } from "./shares";

/**
 * Partial Pounce (PRD §B9, FR-POUNCE-3/4/5). Pure: no I/O.
 * A candidate is a member who pawed in, with their private limit (+ cover pledged to them).
 */

export type Candidate = {
  id: string;
  order: number; // paw-in order (earliest first)
  limitCents: number; // their own committed limit
  coverCents?: number; // cover others pledged to them (funded up front by the coverers)
  weight?: number;
  customCents?: number | null;
};

export type GroupCheck = {
  shares: Record<string, number>;
  short: { id: string; needCents: number }[]; // how much more each short member would need
};

export function checkGroup(cost: CostModel, group: Candidate[]): GroupCheck {
  const shares = planShares(cost, group);
  const short = group
    .map((c) => ({ id: c.id, needCents: shares[c.id] - (c.limitCents + (c.coverCents ?? 0)) }))
    .filter((s) => s.needCents > 0);
  return { shares, short };
}

export type Solution =
  | { feasible: true; groupIds: string[]; shares: Record<string, number>; removed: string[] }
  | { feasible: false; reason: "too_few" | "nobody_fits"; bestSize: number; removed: string[] };

/**
 * Final group after paw-up rounds are over: repeatedly remove the member with the biggest
 * shortfall (latest paw on ties) until everyone fits, or the group drops below `needAtLeast`.
 * Removing one at a time matters: in total-price plans, each removal raises everyone else's share.
 */
export function solveGroup(cost: CostModel, candidates: Candidate[], needAtLeast: number): Solution {
  let group = [...candidates].sort((a, b) => a.order - b.order);
  const removed: string[] = [];
  while (group.length > 0) {
    if (group.length < needAtLeast) return { feasible: false, reason: "too_few", bestSize: group.length, removed };
    const { shares, short } = checkGroup(cost, group);
    if (short.length === 0) return { feasible: true, groupIds: group.map((g) => g.id), shares, removed };
    const worst = short
      .map((s) => ({ ...s, order: group.find((g) => g.id === s.id)!.order }))
      .sort((a, b) => b.needCents - a.needCents || b.order - a.order)[0];
    removed.push(worst.id);
    group = group.filter((g) => g.id !== worst.id);
  }
  return { feasible: false, reason: "nobody_fits", bestSize: 0, removed };
}

/** Who to ask for a paw-up in the current round (FR-POUNCE-4): everyone short, with the exact gap. */
export function pawUpAsks(cost: CostModel, group: Candidate[]): { id: string; needCents: number }[] {
  return checkGroup(cost, group).short;
}

/**
 * Does the plan's pounce rule allow a Pounce right now? (FR-POUNCE-2)
 * `invited` counts members who haven't said "not this time".
 * - everyone: as soon as every remaining invitee is in
 * - at_least: at the deadline, or when the host taps, with ≥ needAtLeast in
 * - host: only when the host taps, with ≥ needAtLeast in
 */
export function ruleAllowsPounce(opts: {
  rule: "everyone" | "at_least" | "host";
  invited: number;
  inCount: number;
  needAtLeast: number;
  atDeadline: boolean;
  hostTapped: boolean;
}): boolean {
  const enough = opts.inCount >= opts.needAtLeast;
  if (opts.rule === "everyone") return enough && opts.inCount === opts.invited;
  if (opts.rule === "at_least") return enough && (opts.atDeadline || opts.hostTapped);
  return enough && opts.hostTapped;
}
