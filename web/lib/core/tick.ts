import { db } from "../db";
import { fadeExpiredWhims } from "./whims";
import { deadlinePassed, expireTagRequests, neverPounced, placeDueHolds, retryPendingPayouts } from "./pounce";
import { payOverrunToBooker } from "./receipts";

/**
 * The timer job (PRD §D8 Phase 1 "Deadlines and timers"). Phase 1: run from the dev console or a keyed
 * endpoint; Phase 2: Render Workflows calls it on a schedule. `now` can be moved forward for testing.
 */
export async function runTick(now = new Date()) {
  const d = await db();
  const faded = await fadeExpiredWhims(now);
  const holdsPlaced = await placeDueHolds(now);
  const pastDeadline = await d.query<{ id: string }>(`select id from plans where status='open' and decide_by < $1`, [now.toISOString()]);
  const deadlines = [];
  for (const p of pastDeadline) deadlines.push({ planId: p.id, result: await deadlinePassed(p.id) });
  // The host never tapped Pounce and the time has come: everyone gets their money back.
  const started = await d.query<{ id: string }>(`select id from plans where status='open' and starts_at is not null and starts_at < $1`, [now.toISOString()]);
  for (const p of started) await neverPounced(p.id);
  const payoutsRetried = await retryPendingPayouts();
  const tagAsksExpired = await expireTagRequests(now);
  // Overruns everyone paid whose money hasn't reached the booker yet.
  const extras = await d.query<{ id: string }>(
    `select p.id from plans p where p.status='pounced' and exists (select 1 from receipts r where r.plan_id=p.id and r.status='confirmed' and r.confirmed_cents is not null)
       and exists (select 1 from plan_members m where m.plan_id=p.id and m.overrun_due_cents>0)
       and not exists (select 1 from plan_members m where m.plan_id=p.id and m.overrun_due_cents>0 and not m.overrun_paid)`,
  );
  let overrunsPaid = 0;
  for (const p of extras) if (await payOverrunToBooker(p.id)) overrunsPaid++;
  return { faded, holdsPlaced, deadlines, payoutsRetried, overrunsPaid, tagAsksExpired };
}
