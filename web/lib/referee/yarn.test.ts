import { describe, expect, it } from "vitest";
import { untangle, yarnBalances } from "./yarn";

describe("Yarn and Untangle (FR-YARN-3, AT-13)", () => {
  // Priya paid $48 dinner for Priya, Sam, Arjun ($16 each); Sam paid $30 cab for Sam, Priya ($15 each);
  // Arjun paid $90 groceries for all three ($30 each).
  const cards = [
    { payer: "priya", parts: [{ user: "sam", cents: 1600 }, { user: "arjun", cents: 1600 }] },
    { payer: "sam", parts: [{ user: "priya", cents: 1500 }] },
    { payer: "arjun", parts: [{ user: "priya", cents: 3000 }, { user: "sam", cents: 3000 }] },
  ];

  it("nets balances to zero", () => {
    const b = yarnBalances(cards);
    expect(b).toEqual({ priya: -1300, sam: -3100, arjun: 4400 });
    expect(Object.values(b).reduce((a, c) => a + c, 0)).toBe(0);
  });

  it("3 cards → at most 3 transfers (n-1), and paying them brings everyone to zero", () => {
    const t = untangle(yarnBalances(cards));
    expect(t.length).toBeLessThanOrEqual(2);
    expect(t).toEqual([
      { from: "sam", to: "arjun", cents: 3100 },
      { from: "priya", to: "arjun", cents: 1300 },
    ]);
    expect(yarnBalances(cards, t)).toEqual({});
  });

  it("treats and the payer's own share don't create debts", () => {
    expect(yarnBalances([{ payer: "a", parts: [{ user: "a", cents: 500 }, { user: "b", cents: 0 }] }])).toEqual({});
  });

  it("a messy circle still settles in n-1 payments", () => {
    const b = { a: -1000, b: -2500, c: 500, d: 3000 };
    const t = untangle(b);
    expect(t.length).toBeLessThanOrEqual(3);
    const after = { ...b };
    for (const x of t) {
      after[x.from as keyof typeof after] += x.cents;
      after[x.to as keyof typeof after] -= x.cents;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
});
