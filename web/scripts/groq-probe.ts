/** Ops: try Groq's live chat models for speed, JSON output and image input. Run: npx tsx scripts/groq-probe.ts */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";
loadEnv();
const key = process.env.GROQ_API_KEY!;
const img = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "chat-cabin.png")).toString("base64");

async function call(model: string, extra: Record<string, unknown>, content: unknown, json = false) {
  const t0 = Date.now();
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content }], max_tokens: 400, temperature: 0.3, ...(json ? { response_format: { type: "json_object" } } : {}), ...extra }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) return `${ms} ms  HTTP ${res.status} ${body.slice(0, 110)}`;
  const out = JSON.parse(body).choices?.[0]?.message?.content ?? "";
  return `${ms} ms  ${JSON.stringify(out).slice(0, 110)}`;
}

async function main() {
  const whim = 'Extract ONE plan idea as JSON {"what","starts_at","price_dollars"} from: "bowling next friday 7pm? lane is $60 total". Output only JSON.';
  for (const [model, extra] of [
    ["openai/gpt-oss-20b", { reasoning_effort: "low" }],
    ["openai/gpt-oss-120b", { reasoning_effort: "low" }],
    ["qwen/qwen3.8-27b", { reasoning_effort: "none" }],
    ["qwen/qwen3.8-27b", {}],
  ] as [string, Record<string, unknown>][]) {
    const tag = `${model}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`;
    console.log(`${tag}\n  short: ${await call(model, extra, "Say hi in three words.")}`);
    console.log(`  json:  ${await call(model, extra, whim, true)}`);
    console.log(`  image: ${await call(model, extra, [{ type: "text", text: "What plan are these friends discussing? Answer in 10 words." }, { type: "image_url", image_url: { url: `data:image/png;base64,${img}` } }])}`);
  }
}
void main();
