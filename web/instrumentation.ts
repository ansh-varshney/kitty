/**
 * Runs once when the server starts. On Render (and only there) the app runs its own scheduled jobs every 15 minutes
 * (lib/core/job-timer.ts). Local dev, tests and the build never start it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (!process.env.RENDER || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startJobTimer } = await import("./lib/core/job-timer");
  startJobTimer();
}
