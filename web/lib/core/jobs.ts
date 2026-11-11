import { runTick } from "./tick";
import { yarnJobs } from "./yarn";
import { remindersJob } from "./reminders";
import { helpJobs } from "./help";
import { partyJobs } from "./party";
import { bowlJobs } from "./bowl";
import { catnipCleanup, catnipRadar } from "./catnip";
import { onBudgetMonthEnd, purrsScan } from "./purrs";
import { ifFree } from "./locks";

/**
 * Every scheduled job in one run (PRD §D1 Phase 2 "jobs: deadlines, Meows, party checks, Catnip clean-up").
 * Called every 15 minutes by the scheduler (a free GitHub Actions schedule; a Render cron once the plan is paid),
 * and from the dev console. Each job is safe to run again: it only acts on what's due.
 */
export async function runJobs(now = new Date()) {
  // The 15-minute schedule and a manual run can overlap: only one run at a time; the other returns straight away
  // (edge case J1: two runs at once must not charge savers or Bowls twice).
  return ifFree("jobs", { ranAt: now.toISOString(), skipped: "another run is still going" }, () => runJobsNow(now));
}

async function runJobsNow(now: Date) {
  const out: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: (e as Error).message };
      console.error(`[jobs] ${name}: ${(e as Error).message}`);
    }
  };
  await step("deadlines", () => runTick(now)); // whims fade, holds placed, paw-up windows, deadlines, payout retries
  await step("yarn", () => yarnJobs(now));
  await step("reminders", () => remindersJob(now));
  await step("help", () => helpJobs(now));
  await step("party", () => partyJobs(now));
  await step("bowl", () => bowlJobs(now));
  await step("catnipRadar", () => catnipRadar(now));
  await step("catnipCleanup", () => catnipCleanup(now));
  await step("purrs", () => purrsScan());
  await step("onBudget", () => onBudgetMonthEnd(now));
  return { ranAt: now.toISOString(), ...out };
}
