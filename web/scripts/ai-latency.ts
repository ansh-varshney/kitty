/** Ops: raw Gemini Flash-Lite latency, and whether a short timeout is enforced. Run: npx tsx scripts/ai-latency.ts */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { generate } = await import("../lib/ai/llm");
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await generate(`Reply with one short friendly sentence about cats. (${i})`, { tier: "fast", timeoutMs: Number(process.argv[2] ?? 3000), template: () => "template" });
    console.log(`${String(Date.now() - t0).padStart(5)} ms  model=${r.model} attempts=${r.attempts}`);
  }
}
void main();
