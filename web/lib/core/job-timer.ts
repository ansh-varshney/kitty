import { runJobs } from "./jobs";

/**
 * The app's own scheduler (PRD §D1 Phase 5). On Render's always-on Starter plan the server never sleeps, so it runs
 * every job itself every 15 minutes: no cron service, no extra secret. A run triggered from outside at the same time
 * (the jobs endpoint) just skips, because only one run goes at a time (lib/core/jobs.ts).
 */
const EVERY_MS = 15 * 60_000;
let started = false;

/** What the health check shows. Kept on globalThis because instrumentation and route handlers are bundled apart. */
export type TimerState = { startedAt: string; runs: number; lastRanAt: string | null; lastMs: number | null; lastError: string | null };
const KEY = "__kittyJobTimer";

export function startJobTimer() {
  if (started) return;
  started = true;
  const state: TimerState = { startedAt: new Date().toISOString(), runs: 0, lastRanAt: null, lastMs: null, lastError: null };
  (globalThis as Record<string, unknown>)[KEY] = state;
  const run = () => {
    const t = Date.now();
    return runJobs().then(
      (out) => {
        Object.assign(state, { runs: state.runs + 1, lastRanAt: new Date().toISOString(), lastMs: Date.now() - t, lastError: null });
        console.log(`[jobs timer] ran in ${Date.now() - t} ms${"skipped" in out ? " (another run was going)" : ""}`);
      },
      (e) => {
        state.lastError = (e as Error).message;
        console.error(`[jobs timer] ${(e as Error).message}`);
      },
    );
  };
  // A minute after the server starts (so a deploy is settled), then every 15 minutes.
  setTimeout(run, 60_000);
  setInterval(run, EVERY_MS);
  console.log("[jobs timer] running every 15 minutes");
}
