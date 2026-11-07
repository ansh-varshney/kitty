/** Ops: run the real whim-reading prompt N times per model and show the spread of response times. Run: npx tsx scripts/ai-stability.ts [n] */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { generateJson, resetQuotaBench } = await import("../lib/ai/llm");
  const n = Number(process.argv[2] ?? 8);
  const prompt = 'Now is Saturday 2026-11-07, 09:00 local time. From this message extract ONE plan idea as JSON {"what","when_text","starts_at","ends_at","up_to_dollars","place","price_dollars"} (starts_at like 2026-12-12T19:00, or null). Output only JSON.\nMESSAGE: "bowling next friday 7pm? lane is $60 total"';
  for (const model of ["groq:qwen/qwen3.8-27b", "groq:openai/gpt-oss-20b", "groq:openai/gpt-oss-120b"]) {
    const times: string[] = [];
    for (let i = 0; i < n; i++) {
      resetQuotaBench();
      const t0 = Date.now();
      try {
        await generateJson(prompt, { models: [model], timeoutMs: 8000 });
        times.push(String(Date.now() - t0));
      } catch (e) {
        times.push(`X(${String((e as Error).message).slice(0, 40)})`);
      }
    }
    console.log(`${model.padEnd(28)} ${times.join("  ")}`);
  }
}
void main();
