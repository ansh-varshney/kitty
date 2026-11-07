import type { Queryable } from "../db";
import { acct, balance } from "./ledger";
import type { Window } from "../referee/time";

/** My Month data the referee needs in Phase 1: spending vs fun budget, and the calendar (PRD §B20). */

// leftover_return is NOT spending: it is the booker handing back other people's money (or a memo for their own part).
const SPEND_KINDS = ["capture", "jar_spend", "savings_spend", "tag_along", "overrun"];
const REFUND_KINDS = ["refund"];

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Money this user put into plans this month, minus what came back. */
export async function monthSpentCents(q: Queryable, userId: string, now = new Date()): Promise<number> {
  const [r] = await q.query<{ spent: string | null; back: string | null }>(
    `select
       coalesce(sum(case when kind = any($2) and account like 'plan:%' and amount_cents > 0 then amount_cents end),0) as spent,
       coalesce(sum(case when kind = any($3) and account like 'plan:%' and amount_cents < 0 then -amount_cents end),0) as back
     from ledger where user_id = $1 and created_at >= $4`,
    [userId, SPEND_KINDS, REFUND_KINDS, monthStart(now)],
  );
  return Number(r.spent ?? 0) - Number(r.back ?? 0);
}

/** Money committed but not yet charged: the user's live holds and reservations on open plans. */
export async function committedCents(q: Queryable, userId: string, excludePlanId?: string): Promise<number> {
  const [r] = await q.query<{ c: string | null }>(
    `select coalesce(sum(p.cents),0) as c from paws p join plans pl on pl.id=p.plan_id
     where p.user_id=$1 and p.status in ('pending','held') and pl.status in ('open','pouncing') and ($2::uuid is null or pl.id <> $2)`,
    [userId, excludePlanId ?? null],
  );
  return Number(r.c ?? 0);
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
