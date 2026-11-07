import { describe, expect, it } from "vitest";
import { expectedShare, planShares, shareLadder, splitCents, type CostModel } from "./shares";
import { checkGroup, ruleAllowsPounce, solveGroup, type Candidate } from "./pounce";
import { leftovers, overrun, tagAlong } from "./settle";
import { decide, freeHandCents, shareable, validateRule, type Rule } from "./rules";
import { acceptSuggestion, clash, pickOption } from "./time";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const total = (c: number): CostModel => ({ priceMode: "total", priceCents: c, splitMode: "equal" });

describe("shares + rounding (FR-POUNCE-6, AT-8)", () => {
  it("$680 split 6 ways = 2 × $113.34 + 4 × $113.33, earliest paws get the extra cent", () => {
    const parts = splitCents(68000, [1, 1, 1, 1, 1, 1]);
    expect(parts).toEqual([11334, 11334, 11333, 11333, 11333, 11333]);
    expect(sum(parts)).toBe(68000);
  });
  it("always sums exactly, for many awkward totals", () => {
    for (const t of [1, 99, 100, 101, 60000, 99999, 123457]) {
      for (const n of [1, 2, 3, 6, 7, 11]) expect(sum(splitCents(t, Array(n).fill(1)))).toBe(t);
    }
  });
  it("weights: a couple counts as 2 shares", () => {
    const s = planShares({ priceMode: "total", priceCents: 60000, splitMode: "weights" }, [
      { id: "couple", order: 1, weight: 2 },
      { id: "a", order: 2 },
      { id: "b", order: 3 },
      { id: "c", order: 4 },
    ]);
    expect(s).toEqual({ couple: 24000, a: 12000, b: 12000, c: 12000 });
  });
  it("custom: one person pays a set amount, the rest split the remainder", () => {
    const s = planShares({ priceMode: "total", priceCents: 70000, splitMode: "custom" }, [
      { id: "ava", order: 1, customCents: 20000 },
      { id: "j", order: 2 },
      { id: "t", order: 3 },
    ]);
    expect(s).toEqual({ ava: 20000, j: 25000, t: 25000 });
  });
  it("per-person price ignores group size", () => {
    expect(planShares({ priceMode: "per_person", priceCents: 1800, splitMode: "equal" }, [{ id: "a", order: 1 }, { id: "b", order: 2 }])).toEqual({ a: 1800, b: 1800 });
  });
  it("share ladder for the paw-in screen", () => {
    expect(shareLadder(total(70000), [4, 5, 6]).map((x) => x.perPersonCents)).toEqual([17500, 14000, 11667]);
  });
});

describe("partial Pounce (FR-POUNCE-3/4, AT-6, AT-7)", () => {
  const cabin = total(70000);
  const five: Candidate[] = [
    { id: "ava", order: 1, limitCents: 20000 },
    { id: "jordan", order: 2, limitCents: 15000 },
    { id: "tyler", order: 3, limitCents: 16000 },
    { id: "zoe", order: 4, limitCents: 14000 },
    { id: "sam", order: 5, limitCents: 13000 },
  ];
  it("story step 8: $700 / 5 = $140; only the $130 member is short, by $10", () => {
    const { shares, short } = checkGroup(cabin, five);
    expect(Object.values(shares)).toEqual([14000, 14000, 14000, 14000, 14000]);
    expect(short).toEqual([{ id: "sam", needCents: 1000 }]);
  });
  it("cover from a friend closes the gap", () => {
    const covered = five.map((c) => (c.id === "sam" ? { ...c, coverCents: 1000 } : c));
    expect(solveGroup(cabin, covered, 4)).toMatchObject({ feasible: true, groupIds: ["ava", "jordan", "tyler", "zoe", "sam"] });
  });
  it("a decline removes one person at a time and recomputes", () => {
    const res = solveGroup(cabin, five, 4);
    // Without Sam: $175 each; jordan (150), tyler (160), zoe (140) are short → the group can't hold.
    expect(res.feasible).toBe(false);
  });
  it("6 invited, 4 in, at least 3 (AT-6): the 4 are charged, nobody else", () => {
    const four: Candidate[] = [
      { id: "a", order: 1, limitCents: 20000 },
      { id: "b", order: 2, limitCents: 20000 },
      { id: "c", order: 3, limitCents: 20000 },
      { id: "d", order: 4, limitCents: 20000 },
    ];
    const res = solveGroup(total(60000), four, 3);
    expect(res).toMatchObject({ feasible: true, groupIds: ["a", "b", "c", "d"], shares: { a: 15000, b: 15000, c: 15000, d: 15000 } });
  });
  it("too few people → not feasible", () => {
    expect(solveGroup(total(60000), [{ id: "a", order: 1, limitCents: 99999 }], 2)).toMatchObject({ feasible: false, reason: "too_few" });
  });
  it("pounce rules", () => {
    const base = { invited: 5, inCount: 5, needAtLeast: 3, atDeadline: false, hostTapped: false };
    expect(ruleAllowsPounce({ ...base, rule: "everyone" })).toBe(true);
    expect(ruleAllowsPounce({ ...base, rule: "everyone", inCount: 4 })).toBe(false);
    expect(ruleAllowsPounce({ ...base, rule: "at_least", inCount: 3 })).toBe(false);
    expect(ruleAllowsPounce({ ...base, rule: "at_least", inCount: 3, atDeadline: true })).toBe(true);
    expect(ruleAllowsPounce({ ...base, rule: "host", inCount: 3, hostTapped: true })).toBe(true);
    expect(ruleAllowsPounce({ ...base, rule: "host", inCount: 2, hostTapped: true })).toBe(false);
  });
});

describe("tag along + leftovers (FR-POUNCE-9, FR-SETTLE-2, AT-9, AT-12)", () => {
  it("story step 11: 5 paid $136; the newcomer pays $113.33 and refunds add up to exactly that", () => {
    const existing = ["ava", "jordan", "tyler", "zoe", "sam"].map((id, i) => ({ id, order: i + 1, paidCents: 13600 }));
    const res = tagAlong(total(68000), existing, { id: "marcus", order: 6 });
    expect(res.newcomerPays).toBe(11333);
    expect(sum(Object.values(res.refunds))).toBe(res.newcomerPays);
    expect(res.refunds).toEqual({ ava: 2266, jordan: 2266, tyler: 2267, zoe: 2267, sam: 2267 });
  });
  it("leftovers go back by what each paid, to each source, summing exactly", () => {
    const paid = [
      { userId: "priya", source: "savings" as const, cents: 8000 },
      { userId: "priya", source: "paypal" as const, cents: 6000 },
      { userId: "sam", source: "paypal" as const, cents: 14000 },
      { userId: "zoe", source: "jar" as const, cents: 1000 },
      { userId: "zoe", source: "paypal" as const, cents: 13000 },
    ];
    const back = leftovers(paid, 1200);
    expect(sum(back.map((b) => b.cents))).toBe(1200);
    const byUser = (u: string) => sum(back.filter((b) => b.userId === u).map((b) => b.cents));
    expect([byUser("priya"), byUser("sam"), byUser("zoe")]).toEqual([400, 400, 400]);
    expect(back.find((b) => b.userId === "priya" && b.source === "savings")!.cents).toBeGreaterThan(back.find((b) => b.userId === "priya" && b.source === "paypal")!.cents);
  });
  it("overrun: ≤15% asks members, more needs the host", () => {
    expect(overrun(70000, 75000)).toEqual({ extraCents: 5000, needsHost: false });
    expect(overrun(70000, 90000).needsHost).toBe(true);
  });
});

describe("House Rules (FR-RULE-3/5, FR-MONTH-2, AT-14, AT-15, AT-16)", () => {
  const rules: Rule[] = [
    { type: "R1", params: { cents: 30000 } },
    { type: "R2", params: { cents: 2000 } },
    { type: "R2", squadId: "goa", params: { cents: 1000 } },
  ];
  const ctx = { rules, jarAvailableCents: 5000, monthSpentCents: 0, monthCommittedCents: 0 };
  it("auto only for Treat Jar money within the free hand (AT-16)", () => {
    expect(decide({ kind: "paw_in", cents: 1800, source: "jar" }, ctx).mode).toBe("auto");
    expect(decide({ kind: "paw_in", cents: 4000, source: "jar" }, ctx).mode).toBe("ask");
    expect(decide({ kind: "paw_in", cents: 500, source: "paypal" }, ctx).mode).toBe("ask");
  });
  it("squads can only lower the free hand", () => {
    expect(freeHandCents(rules, "goa")).toBe(1000);
    expect(freeHandCents([{ type: "R2", params: { cents: 2000 } }, { type: "R2", squadId: "x", params: { cents: 9000 } }], "x")).toBe(2000);
  });
  it("overspending guard: over the fun budget always asks, with the overshoot (AT-14)", () => {
    const d = decide({ kind: "paw_in", cents: 1500, source: "jar" }, { ...ctx, monthSpentCents: 25000, monthCommittedCents: 4000 });
    expect(d).toMatchObject({ mode: "ask", overBudgetByCents: 500 });
  });
  it("personal rules can only make the kitten ask (AT-15)", () => {
    expect(decide({ kind: "paw_in", cents: 100, source: "jar" }, { ...ctx, personalRuleApplies: true }).mode).toBe("ask");
    expect(validateRule({ type: "personal", params: { effect: "allow" } })).toMatch(/only make the kitten ask/);
    expect(validateRule({ type: "personal", params: { effect: "ask" } })).toBeNull();
  });
  it("money is never shareable", () => {
    expect(shareable([{ type: "R4", params: { money: true } }]).money).toBe(false);
  });
});

describe("calendar + choosing + loop guard (FR-CAL-2/3, FR-NEG-3/5, AT-21, AT-23)", () => {
  const d = (s: string) => new Date(s);
  it("a plan you're in is a hard clash; a busy time is soft", () => {
    const c = clash(
      { start: d("2026-12-12T00:00:00Z"), end: d("2026-12-14T00:00:00Z") },
      [{ planId: "cabin", start: d("2026-12-13T00:00:00Z"), end: d("2026-12-15T00:00:00Z") }],
      [{ label: "exams", start: d("2026-12-10T00:00:00Z"), end: d("2026-12-12T12:00:00Z") }],
    );
    expect(c.hard).toEqual({ planId: "cabin" });
    expect(c.soft).toEqual({ label: "exams" });
  });
  it("picks the option most people fit, then by ranking, then cheaper", () => {
    const w1 = { start: d("2026-12-12T00:00:00Z"), end: d("2026-12-14T00:00:00Z") };
    const w2 = { start: d("2026-12-19T00:00:00Z"), end: d("2026-12-21T00:00:00Z") };
    const voters = [
      { id: "a", limitCents: 15000, plansIn: [], busy: [], ranks: { A: 1, B: 2 } },
      { id: "b", limitCents: 15000, plansIn: [{ planId: "x", ...w1 }], busy: [], ranks: { A: 1, B: 2 } },
      { id: "c", limitCents: 15000, plansIn: [], busy: [], ranks: { B: 1, A: 2 } },
    ];
    const { best } = pickOption(
      [
        { key: "A", window: w1, perPersonCents: 14000 },
        { key: "B", window: w2, perPersonCents: 14000 },
      ],
      voters,
    );
    expect(best?.key).toBe("B");
    expect(best?.fits).toEqual(["a", "b", "c"]);
  });
  it("loop guard: max 2 rounds, one per kitten per round, no repeats", () => {
    expect(acceptSuggestion({ round: 3, fromUser: "a", key: "x", alreadyThisRound: [], seenKeys: [] }).ok).toBe(false);
    expect(acceptSuggestion({ round: 1, fromUser: "a", key: "x", alreadyThisRound: ["a"], seenKeys: [] }).ok).toBe(false);
    expect(acceptSuggestion({ round: 2, fromUser: "a", key: "x", alreadyThisRound: [], seenKeys: ["x"] }).ok).toBe(false);
    expect(acceptSuggestion({ round: 2, fromUser: "a", key: "y", alreadyThisRound: [], seenKeys: ["x"] }).ok).toBe(true);
  });
});

describe("expected share (owner request: split by need-at-least or by who's in)", () => {
  const cost = { priceMode: "total" as const, priceCents: 6000, splitMode: "equal" as const };
  const m = (id: string, order: number, extra: object = {}) => ({ id, order, ...extra });
  it("need 3, 2 in: the third person sees $60 / 3", () => {
    expect(expectedShare(cost, { needAtLeast: 3, inMembers: [m("a", 1), m("b", 2)], viewer: m("c", 0), viewerIn: false })).toEqual({ cents: 2000, splitWays: 3, basis: "need" });
  });
  it("need 3, 4 in: the fifth sees $60 / 5", () => {
    const ins = [m("a", 1), m("b", 2), m("c", 3), m("d", 4)];
    expect(expectedShare(cost, { needAtLeast: 3, inMembers: ins, viewer: m("e", 0), viewerIn: false })).toEqual({ cents: 1200, splitWays: 5, basis: "in" });
  });
  it("someone already in sees their share of the current group (at least need)", () => {
    expect(expectedShare(cost, { needAtLeast: 4, inMembers: [m("a", 1)], viewer: m("a", 1), viewerIn: true }).cents).toBe(1500);
  });
  it("weights: a couple counts as 2", () => {
    const w = { ...cost, splitMode: "weights" as const };
    expect(expectedShare(w, { needAtLeast: 3, inMembers: [m("a", 1, { weight: 2 })], viewer: m("b", 0), viewerIn: false })).toEqual({ cents: 1500, splitWays: 3, basis: "need" });
  });
  it("custom: Priya pays $30, the rest is split", () => {
    const c = { ...cost, splitMode: "custom" as const };
    expect(expectedShare(c, { needAtLeast: 3, inMembers: [m("p", 1, { customCents: 3000 })], viewer: m("b", 0), viewerIn: false }).cents).toBe(1500);
  });
});
