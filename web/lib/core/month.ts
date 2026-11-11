import type { Queryable } from "../db";
import { acct, balance } from "./ledger";
import type { Window } from "../referee/time";

/** My Month data the referee needs in Phase 1: spending vs fun budget, and the calendar (PRD §B20). */

// leftover_return is NOT spending: it is the booker handing back other people's money (or a memo for their own part).
export const SPEND_KINDS = ["capture", "jar_spend", "savings_spend", "tag_along", "overrun"];
export const REFUND_KINDS = ["refund"];

export function monthRange(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}

export type Spending = {
  totalCents: number;
  byKind: { plans: number; gifts: number; yarn: number; help: number; bowl: number };
  bySquad: { squadId: string | null; squad: string; cents: number }[];
};

/**
 * Everything this user spent on friends this month (PRD §B20, FR-MONTH-1): plans and gifts (net of refunds), their
 * share of confirmed "I paid" cards (a treat counts in full for the payer; loans don't count), help given, Bowl
 * shares. The overspending guard uses the same total (FR-MONTH-2).
 */
export async function monthSpending(q: Queryable, userId: string, now = new Date()): Promise<Spending> {
  const { start, end } = monthRange(now);
  const plans = await q.query<{ squad_id: string; name: string; kind: string; c: string }>(
    `select s.id as squad_id, s.name, s.kind,
       sum(case when l.kind = any($2) and l.amount_cents > 0 then l.amount_cents when l.kind = any($3) and l.amount_cents < 0 then l.amount_cents else 0 end) as c
     from ledger l join plans p on l.account = 'plan:' || p.id join squads s on s.id = p.squad_id
     where l.user_id = $1 and l.created_at >= $4 and l.created_at < $5 group by s.id, s.name, s.kind`,
    [userId, SPEND_KINDS, REFUND_KINDS, start, end],
  );
  const yarn = await q.query<{ squad_id: string; name: string; c: string }>(
    `select s.id as squad_id, s.name, sum(x.c) as c from (
       select c.squad_id, p.cents as c from yarn_cards c join yarn_parts p on p.card_id=c.id
        where p.user_id=$1 and c.status='confirmed' and c.kind <> 'loan' and c.created_at >= $2 and c.created_at < $3
       union all
       select c.squad_id, case when c.kind='treat' then c.cents else c.cents - coalesce((select sum(cents) from yarn_parts where card_id=c.id),0) end as c
        from yarn_cards c where c.payer_id=$1 and c.status='confirmed' and c.kind <> 'loan' and c.created_at >= $2 and c.created_at < $3
     ) x join squads s on s.id=x.squad_id group by s.id, s.name`,
    [userId, start, end],
  );
  const [other] = await q.query<{ help: string | null; bowl: string | null }>(
    `select coalesce(sum(case when kind='help_give' and account like 'help:%' and amount_cents > 0 then amount_cents end),0) as help,
            coalesce(sum(case when kind='bowl_share' and account like 'bowl:%' and amount_cents > 0 then amount_cents end),0) as bowl
     from ledger where user_id=$1 and created_at >= $2 and created_at < $3`,
    [userId, start, end],
  );
  const bowlBySquad = await q.query<{ squad_id: string; name: string; c: string }>(
    `select s.id as squad_id, s.name, sum(l.amount_cents) as c from ledger l join bowls b on l.account = 'bowl:' || b.id join squads s on s.id=b.squad_id
     where l.user_id=$1 and l.kind='bowl_share' and l.amount_cents > 0 and l.created_at >= $2 and l.created_at < $3 group by s.id, s.name`,
    [userId, start, end],
  );
  const byKind = {
    plans: plans.filter((p) => p.kind !== "gift").reduce((a, p) => a + Number(p.c), 0),
    gifts: plans.filter((p) => p.kind === "gift").reduce((a, p) => a + Number(p.c), 0),
    yarn: yarn.reduce((a, y) => a + Number(y.c), 0),
    help: Number(other.help ?? 0),
    bowl: Number(other.bowl ?? 0),
  };
  const squads = new Map<string, { squadId: string | null; squad: string; cents: number }>();
  for (const r of [...plans.map((p) => ({ ...p, name: p.kind === "gift" ? "Gifts" : p.name })), ...yarn, ...bowlBySquad]) {
    const k = r.name === "Gifts" ? "gifts" : r.squad_id;
    const cur = squads.get(k) ?? { squadId: r.name === "Gifts" ? null : r.squad_id, squad: r.name, cents: 0 };
    cur.cents += Number(r.c);
    squads.set(k, cur);
  }
  if (byKind.help) squads.set("help", { squadId: null, squad: "Nine Lives (help given)", cents: byKind.help });
  const totalCents = Object.values(byKind).reduce((a, b) => a + b, 0);
  return { totalCents, byKind, bySquad: [...squads.values()].filter((s) => s.cents !== 0).sort((a, b) => b.cents - a.cents) };
}

/** Total spent on friends this month (used by the overspending guard and the House Rules check). */
export async function monthSpentCents(q: Queryable, userId: string, now = new Date()): Promise<number> {
  return (await monthSpending(q, userId, now)).totalCents;
}

/** Money committed but not yet charged: the user's live holds and reservations on open plans. */
export async function committedCents(q: Queryable, userId: string, excludePlanId?: string): Promise<number> {
  const [r] = await q.query<{ c: string | null }>(
    `select coalesce(sum(p.cents),0) as c from paws p join plans pl on pl.id=p.plan_id
     where p.user_id=$1 and p.status in ('pending','held') and pl.status in ('open','pouncing') and ($2::uuid is null or pl.id <> $2)`,
    [userId, excludePlanId ?? null],
  );
  // Shares set aside on a whim, or to tag along, are spoken for too (FR-JAR-8).
  const [o] = await q.query<{ c: string | null }>(
    `select coalesce((select sum(jar_cents + savings_cents) from whim_holds where user_id=$1 and status='held'),0)
          + coalesce((select sum(held_jar + held_savings) from tag_requests where user_id=$1 and status='asked'),0) as c`,
    [userId],
  );
  return Number(r.c ?? 0) + Number(o.c ?? 0);
}

export async function jarBalances(q: Queryable, userId: string) {
  return { availableCents: await balance(q, acct.jar(userId)), heldCents: await balance(q, acct.jarHeld(userId)) };
}

export async function savingsBalance(q: Queryable, squadId: string, userId: string) {
  return balance(q, acct.savings(squadId, userId));
}

/** Plans the user is IN (hard clashes) and busy times they added (soft clashes). */
export async function calendar(q: Queryable, userId: string, excludePlanId?: string) {
  const plans = await q.query<{ id: string; title: string; starts_at: string | null; ends_at: string | null; decide_by: string; status: string }>(
    `select pl.id, pl.title, pl.starts_at, pl.ends_at, pl.decide_by, pl.status from plans pl
     join plan_members m on m.plan_id=pl.id and m.user_id=$1 and m.status='in'
     where pl.status not in ('cancelled') and ($2::uuid is null or pl.id <> $2)`,
    [userId, excludePlanId ?? null],
  );
  const busy = await q.query<{ id: string; starts_at: string; ends_at: string; label: string | null }>(
    `select id, starts_at, ends_at, label from busy_blocks where user_id=$1 order by starts_at`,
    [userId],
  );
  // Same window rule as everywhere else: no end time = 3 hours (a zero-length window could never clash).
  const plansIn = plans
    .filter((p) => p.starts_at)
    .map((p) => ({ planId: p.id, title: p.title, ...windowOf(p.starts_at, p.ends_at)! }));
  const busyW = busy.map((b) => ({ id: b.id, label: b.label, start: new Date(b.starts_at), end: new Date(b.ends_at) }));
  return { plans, plansIn, busy: busyW };
}

export function windowOf(starts: string | null, ends: string | null): Window | null {
  if (!starts) return null;
  const s = new Date(starts);
  const e = ends ? new Date(ends) : new Date(s.getTime() + 3 * 3600_000);
  return { start: s, end: e };
}
