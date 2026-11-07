/** Ops: list the models each configured provider offers right now, and flag catalogue entries that are missing. Run: npx tsx scripts/ai-models.ts */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { CATALOG } = await import("../lib/ai/llm");
  const providers = [
    { name: "groq", key: process.env.GROQ_API_KEY, url: "https://api.groq.com/openai/v1/models" },
  ];
  for (const p of providers) {
    if (!p.key) {
      console.log(`${p.name}: no key`);
      continue;
    }
    const res = await fetch(p.url, { headers: { Authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.log(`${p.name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
      continue;
    }
    const ids = ((await res.json()) as { data: { id: string }[] }).data.map((m) => m.id).sort();
    console.log(`${p.name}: ${ids.length} models`);
    for (const m of CATALOG.filter((c) => c.provider === p.name)) console.log(`  ${ids.includes(m.id) ? "available" : "MISSING  "}  ${m.id}`);
    console.log(`  others: ${ids.filter((i) => !CATALOG.some((c) => c.id === i)).slice(0, 25).join(", ")}`);
  }
}
main().catch((e) => console.error(String((e as Error).message).slice(0, 200)));
