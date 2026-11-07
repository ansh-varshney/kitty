/**
 * Phase 0 spike runner: `npm run spike` (from web/). Runs every automatic step against the
 * PayPal sandbox and Gemini, prints a table, and saves the results to .spike/results.json.
 * Steps that need a human (approving on PayPal) are listed with their links.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";

loadEnv();

async function main() {
  const { STEPS, runStep } = await import("../lib/spike/steps");
  const only = process.argv.slice(2);
  const names = Object.keys(STEPS).filter((n) => (only.length ? only.includes(n) : n !== "webhook"));
  const results: Record<string, unknown> = {};
  let failed = 0;
  for (const name of names) {
    const t0 = Date.now();
    const r = await runStep(name);
    results[name] = r;
    if (!r.ok && !r.skipped) failed++;
    console.log(`${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${name.padEnd(14)} ${String(Date.now() - t0).padStart(6)} ms  ${r.summary}`);
    if (r.needsYou) console.log(`      needs you: ${r.needsYou.label}`);
    if (!r.ok && r.data) console.log("      details:", JSON.stringify(r.data).slice(0, 600));
  }
  const dir = path.join(process.cwd(), ".spike");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(results, null, 2));
  console.log(`\n${names.length - failed}/${names.length} steps passed. Full results: .spike/results.json`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
