/**
 * Yarn and Untangle (PRD §B11, FR-YARN-3): who owes whom inside a squad, and the fewest payments that settle it.
 * Pure functions, integer cents. A positive balance = the squad owes you; negative = you owe.
 */

export type YarnCard = { payer: string; parts: { user: string; cents: number }[] };
export type Transfer = { from: string; to: string; cents: number };
export type Balances = Record<string, number>;

/** Net balances from confirmed cards and the settlements already paid. Always sums to zero. */
export function yarnBalances(cards: YarnCard[], paid: Transfer[] = []): Balances {
  const b: Balances = {};
  const add = (u: string, c: number) => (b[u] = (b[u] ?? 0) + c);
  for (const card of cards) {
    for (const p of card.parts) {
      if (p.user === card.payer || p.cents <= 0) continue;
      add(card.payer, p.cents); // the payer is owed
      add(p.user, -p.cents); // this person owes
    }
  }
  for (const t of paid) {
    add(t.from, t.cents); // paying back reduces what you owe
    add(t.to, -t.cents);
  }
  for (const k of Object.keys(b)) if (b[k] === 0) delete b[k];
  return b;
}

/**
 * Fewest payments that bring every balance to zero (greedy: biggest debtor pays biggest creditor).
 * Produces at most n-1 transfers for n people with non-zero balances. Ties break by id, so it's deterministic.
 */
export function untangle(balances: Balances): Transfer[] {
  const debt = Object.entries(balances).filter(([, c]) => c < 0).map(([u, c]) => ({ u, c: -c }));
  const cred = Object.entries(balances).filter(([, c]) => c > 0).map(([u, c]) => ({ u, c }));
  const byBig = (a: { u: string; c: number }, b: { u: string; c: number }) => b.c - a.c || a.u.localeCompare(b.u);
  const out: Transfer[] = [];
  debt.sort(byBig);
  cred.sort(byBig);
  while (debt.length && cred.length) {
    const d = debt[0];
    const c = cred[0];
    const cents = Math.min(d.c, c.c);
    out.push({ from: d.u, to: c.u, cents });
    d.c -= cents;
    c.c -= cents;
    if (d.c === 0) debt.shift();
    if (c.c === 0) cred.shift();
    debt.sort(byBig);
    cred.sort(byBig);
  }
  return out;
}
