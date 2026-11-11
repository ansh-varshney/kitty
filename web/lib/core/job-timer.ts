import { runJobs } from "./jobs";

/**
 * The app's own scheduler (PRD §D1 Phase 5). On Render's always-on Starter plan the server never sleeps, so it runs
 * every job itself every 15 minutes: no cron service, no extra secret. A run triggered from outside at the same time
 * (the jobs endpoint) just skips, because only one run goes at a time (lib/core/jobs.ts).
 */
const EVERY_MS = 15 * 60_000;
let started = false;

export function startJobTimer() {
  if (started) return;
  started = true;
  const run = () => {
    const t = Date.now();
    return runJobs().then(
      (out) => console.log(`[jobs timer] ran in ${Date.now() - t} ms${"skipped" in out ? " (another run was going)" : ""}`),
      (e) => console.error(`[jobs timer] ${(e as Error).message}`),
    );
  };
  // A minute after the server starts (so a deploy is settled), then every 15 minutes.
  setTimeout(run, 60_000);
  setInterval(run, EVERY_MS);
  console.log("[jobs timer] running every 15 minutes");
}
