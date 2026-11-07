/** Ops: Groq's rate limits for each catalogue model, read from the response headers. Run: npx tsx scripts/groq-limits.ts */
import { loadEnv } from "../lib/load-env";
loadEnv();
async function main() {
  const { CATALOG } = await import("../lib/ai/llm");
  for (const m of CATALOG.filter((c) => c.provider === "groq")) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: m.id, messages: [{ role: "user", content: "hi" }], max_tokens: 5, ...(m.params ?? {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const h = (n: string) => res.headers.get(n) ?? "?";
    console.log(`${m.id.padEnd(22)} HTTP ${res.status}  requests/day ${h("x-ratelimit-limit-requests")} (left ${h("x-ratelimit-remaining-requests")})  tokens/min ${h("x-ratelimit-limit-tokens")}`);
  }
}
void main();
