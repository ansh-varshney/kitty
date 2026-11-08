import { randomUUID } from "node:crypto";
import type { Queryable } from "../db";

/**
 * Double-entry ledger (PRD §D8 Phase 1, FR-JAR-3, NFR-3). Every movement is a set of entries
 * that sums to zero. Accounts:
 *   world                      money outside Kitty (PayPal)
 *   jar:{user}                 Treat Jar, available
 *   jar_held:{user}            Treat Jar, reserved for plans
 *   savings:{squad}:{user}     Kitty Party savings (one party per squad in v1)
 *   savings_held:{squad}:{user}
 *   plan:{plan}                a plan's pot
 *   yarn:{squad} / help:{request} / bowl:{bowl}   pass-through pots for Phase 2 (always back to 0)
 */

export type Entry = { account: string; cents: number };

export const acct = {
  world: "world",
  jar: (u: string) => `jar:${u}`,
  jarHeld: (u: string) => `jar_held:${u}`,
  savings: (s: string, u: string) => `savings:${s}:${u}`,
  savingsHeld: (s: string, u: string) => `savings_held:${s}:${u}`,
  plan: (p: string) => `plan:${p}`,
  // Phase 2
  yarn: (s: string) => `yarn:${s}`, //            settling Yarn: money passes through on its way to the person owed
  help: (r: string) => `help:${r}`, //            a Nine Lives request's pot
  bowl: (b: string) => `bowl:${b}`, //            a Bowl cycle's collected shares
};

export async function post(
  q: Queryable,
  entries: Entry[],
  meta: { kind: string; userId?: string | null; planId?: string | null; reason?: string; paypalId?: string | null },
): Promise<string> {
  const total = entries.reduce((a, e) => a + e.cents, 0);
  if (total !== 0) throw new Error(`ledger entries must sum to zero (got ${total})`);
  if (entries.some((e) => !Number.isInteger(e.cents))) throw new Error("ledger amounts must be integer cents");
  const txn = randomUUID();
  for (const e of entries) {
    if (e.cents === 0) continue;
    await q.query(
      `insert into ledger (txn, account, amount_cents, kind, user_id, plan_id, reason, paypal_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [txn, e.account, e.cents, meta.kind, meta.userId ?? null, meta.planId ?? null, meta.reason ?? null, meta.paypalId ?? null],
    );
  }
  return txn;
}

/** A person's own money in Kitty: these balances may never go below $0 (FR-JAR-3, FR-PARTY-6). */
const OWNED = ["jar:", "jar_held:", "savings:", "savings_held:"];
export const isOwnedAccount = (account: string) => OWNED.some((p) => account.startsWith(p));

/** Move cents from one account to another (one balanced pair). Refuses to overdraw someone's own money. */
export async function move(q: Queryable, from: string, to: string, cents: number, meta: Parameters<typeof post>[2]) {
  if (cents <= 0) return "";
  if (isOwnedAccount(from)) {
    const have = await balance(q, from);
    if (have < cents) {
      const what = from.startsWith("jar") ? "Treat Jar" : "savings";
      throw new Error(`Not enough in your ${what}: $${(have / 100).toFixed(2)} available.`);
    }
  }
  return post(q, [{ account: from, cents: -cents }, { account: to, cents }], meta);
}

export async function balance(q: Queryable, account: string): Promise<number> {
  const [r] = await q.query<{ b: string | null }>(`select coalesce(sum(amount_cents),0) as b from ledger where account = $1`, [account]);
  return Number(r.b ?? 0);
}

/** Invariant check: the whole ledger sums to zero, and a settled plan's pot is empty (NFR-3). */
export async function ledgerSumsToZero(q: Queryable): Promise<boolean> {
  const [r] = await q.query<{ b: string | null }>(`select coalesce(sum(amount_cents),0) as b from ledger`);
  return Number(r.b ?? 0) === 0;
}
