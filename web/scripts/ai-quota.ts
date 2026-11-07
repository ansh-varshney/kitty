/**
 * Ops: is each configured AI model answering right now, how fast, and what limit it hit if not.
 * Run from web/:  npx tsx scripts/ai-quota.ts
 */
import { loadEnv } from "../lib/load-env";
loadEnv();

async function main() {
  const { CATALOG, generate } = await import("../lib/ai/llm");
  const keys: Record<string, string | undefined> = { groq: process.env.GROQ_API_KEY, gemini: process.env.GEMINI_API_KEY };
  for (const m of CATALOG) {
    const name = `${m.provider}:${m.id}`;
    if (!keys[m.provider]) {
      console.log(`${name.padEnd(52)} no key`);
      continue;
    }
    const t0 = Date.now();
    try {
      const r = await generate("Say hi in three words.", { models: [name], timeoutMs: 15000 });
      console.log(`${name.padEnd(52)} OK   ${String(Date.now() - t0).padStart(5)} ms  "${r.text.trim().slice(0, 40)}"`);
    } catch (e) {
      const msg = String((e as Error).message);
      const q = /"quotaId":"([^"]+)"/.exec(msg)?.[1];
      console.log(`${name.padEnd(52)} FAIL ${String(Date.now() - t0).padStart(5)} ms  ${q ?? msg.slice(0, 110)}`);
    }
  }
}
void main();
