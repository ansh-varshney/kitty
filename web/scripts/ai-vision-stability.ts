/** Ops: time the screenshot read N times on Qwen (Groq), uncapped, to see the spread. Run: npx tsx scripts/ai-vision-stability.ts [n] */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const n = Number(process.argv[2] ?? 8);
  const img = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "chat-cabin.png")).toString("base64");
  const times: string[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        reasoning_effort: "none",
        max_tokens: 300,
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${img}` } }, { type: "text", text: 'Extract ONE plan as JSON {"what","when_text","price_dollars","up_to_dollars","place"}. Output only JSON.' }] }],
      }),
      signal: AbortSignal.timeout(30000),
    }).catch((e) => ({ ok: false, status: 0, headers: new Headers(), text: async () => String(e) }) as unknown as Response);
    const ms = Date.now() - t0;
    times.push(res.ok ? String(ms) : `X${res.status}(${ms})`);
    if (!res.ok) console.log("   ", res.status, (await res.text()).slice(0, 140), "retry-after:", res.headers.get("retry-after"));
  }
  console.log("qwen image read ms:", times.join("  "));
}
void main();
