import { db } from "../db";
import { fadeExpiredWhims } from "./whims";
import { placeDueHolds, retryPendingPayouts, tryPounce } from "./pounce";

/**
 * The timer job (PRD §D8 Phase 1 "Deadlines and timers"). Phase 1: run from the dev console or a keyed
 * endpoint; Phase 2: Render Workflows calls it on a schedule. `now` can be moved forward for testing.
 */
export async function runTick(now = new Date()) {
  const d = await db();
  const faded = await fadeExpiredWhims(now);
  const holdsPlaced = await placeDueHolds(now);
  const pawUpDone = await d.query<{ id: string }>(`select id from plans where status='open' and pawup_until is not null and pawup_until < $1`, [now.toISOString()]);
  const finalized = [];
  for (const p of pawUpDone) finalized.push({ planId: p.id, result: await tryPounce(p.id, { finalize: true }) });
  const pastDeadline = await d.query<{ id: string }>(`select id from plans where status='open' and decide_by < $1`, [now.toISOString()]);
  const deadlines = [];
  for (const p of pastDeadline) deadlines.push({ planId: p.id, result: await tryPounce(p.id, { atDeadline: true }) });
  const payoutsRetried = await retryPendingPayouts();
  return { faded, holdsPlaced, finalized, deadlines, payoutsRetried };
}
