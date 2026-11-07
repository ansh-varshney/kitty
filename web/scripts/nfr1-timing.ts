/**
 * NFR-1: "prepared answers MUST be ready within 5 s of a whim being shared". Times createWhim end to end
 * (parse + every friend's prepared answer and reason line) on an in-memory DB. No PayPal calls.
 * Run from web/:  npm run timing:nfr1
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";

loadEnv();
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;

async function main() {
  const { seedDemoWorld } = await import("../lib/core/seed");
  const { createWhim } = await import("../lib/core/whims");
  const { db } = await import("../lib/db");
  const world = await seedDemoWorld({ jarTopUpCents: 4000, realTopUps: false });
  const img = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "chat-cabin.png")).toString("base64");
  const cases: [string, Parameters<typeof createWhim>[1]][] = [
    ["text", { squadId: world.squadId, text: "Bowling this Friday 7pm? like $20 each" }],
    ["text", { squadId: world.squadId, text: "sushi dinner saturday night, around $40 a person" }],
    ["screenshot", { squadId: world.squadId, imageBase64: img, mimeType: "image/png" }],
    ["typed fields", { squadId: world.squadId, what: "Escape room", startsAt: "2026-12-05T18:00:00Z", endsAt: "2026-12-05T20:00:00Z", priceCents: 15000 }],
  ];
  const d = await db();
  let worst = 0;
  for (const [kind, input] of cases) {
    const t0 = Date.now();
    const w = await createWhim(world.users.ava, input);
    const ms = Date.now() - t0;
    worst = Math.max(worst, ms);
    const rows = await d.query<{ prepared: string; prepared_reason: string; facts: { facts: string[] } }>(`select prepared, prepared_reason, facts from answers where whim_id=$1`, [w.whimId]);
    const [wr] = await d.query<{ starts_at: string | null; price_cents: number | null; up_to_cents: number | null }>(`select starts_at, price_cents, up_to_cents from whims where id=$1`, [w.whimId]);
    const templated = rows.filter((r) => r.facts.facts.length > 1 && r.prepared_reason.includes("; ")).length; // templates join facts with "; "
    console.log(`${ms <= 5000 ? "PASS" : "SLOW"} ${String(ms).padStart(5)} ms  ${kind.padEnd(12)} "${w.what}" starts=${wr.starts_at} price=${wr.price_cents} upTo=${wr.up_to_cents}  ${rows.length} answers (${templated} template lines)`);
    for (const r of rows.slice(0, 2)) console.log(`      ${r.prepared.padEnd(5)} facts=${JSON.stringify(r.facts.facts)}  →  "${r.prepared_reason}"`);
  }
  console.log(`worst ${worst} ms (NFR-1 target 5000 ms)`);
  process.exit(0);
}
void main();
