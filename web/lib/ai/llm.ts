import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * The kitten's AI, provider-neutral (PRD §C2, FR-AI-1/2; owner decision 7 Nov: move off Gemini as the main model).
 * A chain of models across providers, fastest first: Groq → Gemini (owner: no Mistral). Only providers with a key are used.
 * Every step has a time budget; a slow or rate-limited model is rested; when everything fails, callers fall back to
 * code (templates, the code whim reader, keyword chat), so the app never stops working.
 */

export type Provider = "groq" | "gemini";
export type Model = { provider: Provider; id: string; vision: boolean; params?: Record<string, unknown> };

/**
 * Fastest first, checked against Groq's LIVE model list for this account (scripts/ai-models.ts, 7 Nov): the Llama
 * models third-party articles listed were not offered. Measured (scripts/groq-probe.ts): Qwen 3.8 27B answers in
 * 0.1–0.2 s and reads screenshots in ~0.4 s; gpt-oss-20b/120b answer in 0.2–0.5 s but can't take images.
 */
// Order matters: each Groq model has its own limit (1,000 requests a day, ~7,000 input tokens a minute). A screenshot
// costs ~1,800 tokens, so text goes to gpt-oss-20b first (steady 0.3–0.6 s) and Qwen's budget is kept for images.
export const CATALOG: Model[] = [
  { provider: "groq", id: "openai/gpt-oss-20b", vision: false, params: { reasoning_effort: "low" } },
  { provider: "groq", id: "qwen/qwen3.8-27b", vision: true, params: { reasoning_effort: "none" } },
  { provider: "groq", id: "openai/gpt-oss-120b", vision: false, params: { reasoning_effort: "low" } },
  { provider: "gemini", id: "gemini-3.1-flash-lite", vision: true },
  { provider: "gemini", id: "gemini-3.5-flash", vision: true },
];

export type Tier = "fast" | "smart";
export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
export type Prompt = string | Part[];

const hasImage = (p: Prompt) => typeof p !== "string" && p.some((x) => "inlineData" in x);

function keyFor(provider: Provider): string | undefined {
  const e = env();
  return provider === "groq" ? e.GROQ_API_KEY : e.GEMINI_API_KEY;
}

/** The models to try for this prompt, in order: configured providers only; images need a vision model. */
export function chainFor(prompt: Prompt): string[] {
  const image = hasImage(prompt);
  return CATALOG.filter((m) => keyFor(m.provider) && (!image || m.vision)).map((m) => `${m.provider}:${m.id}`);
}

type Generate = (model: string, prompt: Prompt, opts: { json: boolean; system?: string; timeoutMs: number }) => Promise<string>;

class AiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Groq speaks the OpenAI chat-completions format. */
async function openAiCompatible(provider: "groq", model: string, prompt: Prompt, opts: { json: boolean; system?: string; timeoutMs: number }) {
  const base = "https://api.groq.com/openai/v1";
  const content =
    typeof prompt === "string"
      ? prompt
      : prompt.map((p) =>
          "text" in p ? { type: "text", text: p.text } : { type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } },
        );
  const body: Record<string, unknown> = {
    model,
    messages: [...(opts.system ? [{ role: "system", content: opts.system }] : []), { role: "user", content }],
    temperature: 0.4,
    max_tokens: 700,
    ...(CATALOG.find((m) => m.provider === provider && m.id === model)?.params ?? {}),
  };
  // JSON mode for text prompts; for images we ask for JSON in words and read it out (not every vision model has JSON mode).
  if (opts.json && !hasImage(prompt)) body.response_format = { type: "json_object" };
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${keyFor(provider)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs),
  }).catch((e: Error) => {
    throw new AiError(e.name === "TimeoutError" || /abort/i.test(e.message) ? `timeout after ${opts.timeoutMs} ms` : `${provider} network error: ${e.message}`);
  });
  const text = await res.text();
  if (!res.ok) {
    const ra = Number(res.headers.get("retry-after"));
    throw new AiError(`${provider} ${res.status}: ${text.slice(0, 300)}`, res.status, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }
  const out = (JSON.parse(text) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
  if (!out) throw new AiError(`${provider}: empty response`);
  return out;
}

let gemini: GoogleGenAI | undefined;
async function geminiCall(model: string, prompt: Prompt, opts: { json: boolean; system?: string; timeoutMs: number }) {
  gemini ??= new GoogleGenAI({ apiKey: env().GEMINI_API_KEY! });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError(`timeout after ${opts.timeoutMs} ms`)), opts.timeoutMs);
  });
  const call = gemini.models.generateContent({
    model,
    contents: typeof prompt === "string" ? prompt : [{ role: "user", parts: prompt }],
    config: {
      ...(opts.system ? { systemInstruction: opts.system } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      abortSignal: AbortSignal.timeout(opts.timeoutMs),
    },
  });
  call.catch(() => undefined); // a call that loses the race must not become an unhandled rejection
  const res = await Promise.race([call, cutoff]).finally(() => clearTimeout(timer));
  if (!res.text) throw new AiError("gemini: empty response");
  return res.text;
}

const realGenerate: Generate = async (model, prompt, opts) => {
  const i = model.indexOf(":");
  const provider = model.slice(0, i) as Provider;
  const id = model.slice(i + 1);
  return provider === "gemini" ? geminiCall(id, prompt, opts) : openAiCompatible(provider, id, prompt, opts);
};

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 503 || status === 500 || status === 502 || /429|503|500|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|timeout|aborted|network/i.test(msg);
}

/**
 * Rate-limit errors (429) are not "busy": retrying the same model wastes time. The model rests until the provider's
 * own retry time (Retry-After, or Gemini's retryDelay), or a short cool-off, and the call moves on at once.
 */
const benchedUntil = new Map<string, number>();
const strikes = new Map<string, { n: number; at: number }>();
export function quotaCooloffMs(err: unknown): number | null {
  const msg = String((err as { message?: string })?.message ?? err);
  const status = (err as { status?: number })?.status;
  if (status !== 429 && !/\b429\b|RESOURCE_EXHAUSTED|exceeded your current quota|rate limit/i.test(msg)) return null;
  const precise = /try again in ([\d.]+)s/i.exec(msg); // Groq: "Please try again in 3.865s" (its header rounds up to 7)
  if (precise) return Math.ceil(Number(precise[1]) * 1000) + 100;
  const after = (err as { retryAfterMs?: number })?.retryAfterMs;
  if (after) return Math.min(after, 24 * 3600_000);
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(msg);
  if (delay) return Math.min(Number(delay[1]) * 1000, 24 * 3600_000);
  return /PerDay|per day|RPD|TPD/i.test(msg) ? 3600_000 : 30_000;
}
export function resetQuotaBench() {
  benchedUntil.clear();
  strikes.clear();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GenResult = { text: string; model: string; fallback: boolean; attempts: number };

export async function generate(
  prompt: Prompt,
  opts: { tier?: Tier; json?: boolean; system?: string; timeoutMs?: number; deadlineMs?: number; template?: () => string; impl?: Generate; models?: string[] } = {},
): Promise<GenResult> {
  const chain = opts.models ?? chainFor(prompt);
  // deadlineMs = the whole budget across every attempt and model (Phase 1: a whim took 34 s while Gemini was overloaded).
  const deadline = opts.deadlineMs ? Date.now() + opts.deadlineMs : Infinity;
  const left = () => deadline - Date.now();
  const impl = opts.impl ?? realGenerate;
  let attempts = 0;
  let lastErr: unknown;
  for (const [idx, model] of chain.entries()) {
    if ((benchedUntil.get(model) ?? 0) > Date.now()) continue;
    const othersLeft = () => chain.slice(idx + 1).some((m) => (benchedUntil.get(m) ?? 0) <= Date.now());
    for (let i = 0; i < 2; i++) {
      if (left() < 300) break;
      attempts++;
      try {
        // Groq usually answers in 0.3 s but sometimes spikes to 8 s (7 Nov): cap each attempt so a spike costs little.
        const cap = model.startsWith("groq:") ? (hasImage(prompt) ? 5000 : 2500) : Infinity;
        const text = await impl(model, prompt, { json: opts.json ?? false, system: opts.system, timeoutMs: Math.min(opts.timeoutMs ?? 12_000, left(), cap) });
        strikes.delete(model);
        return { text, model, fallback: false, attempts };
      } catch (err) {
        lastErr = err;
        const cool = quotaCooloffMs(err);
        if (cool != null) {
          // A short per-minute limit ("try again in 3.9 s") is worth waiting for if the budget allows: the next model
          // may be much slower (for screenshots that's Gemini). Otherwise rest it and move on.
          if (i === 0 && cool <= 5000 && left() > cool + 1500) {
            await sleep(cool);
            continue;
          }
          benchedUntil.set(model, Date.now() + cool);
          break; // rate-limited: next model now
        }
        if (!isRetryable(err)) break; // e.g. 400/404 (bad request, model retired): next model
        // A slow call. One is usually a fluke: try the same model once more (it's often back to 0.3 s). Two within a
        // minute means trouble: rest it for 30 s (so during an outage only a few requests pay the wait) and move on.
        if (/timeout|aborted/i.test(String((err as Error)?.message))) {
          const s = strikes.get(model);
          const n = s && Date.now() - s.at < 60_000 ? s.n + 1 : 1;
          strikes.set(model, { n, at: Date.now() });
          if (n >= 2) {
            benchedUntil.set(model, Math.max(benchedUntil.get(model) ?? 0, Date.now() + 30_000));
            if (othersLeft()) break;
          }
          continue; // retry now, no sleep
        }
        await sleep(Math.min(300 * 2 ** i, Math.max(0, left() - 300)));
      }
    }
  }
  if (opts.template) {
    console.warn(`[ai] template fallback after ${attempts} attempt(s): ${String((lastErr as Error)?.message ?? (chain.length ? "all models resting" : "no AI key configured")).slice(0, 160)}`);
    return { text: opts.template(), model: "template", fallback: true, attempts };
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? (chain.length ? "All AI models are resting" : "No AI key configured")));
}

/** JSON helper: reads the JSON object out of the model's answer; the caller validates it with zod (FR-AI-3). */
export async function generateJson<T>(prompt: Prompt, opts: Parameters<typeof generate>[1] = {}): Promise<{ data: T } & GenResult> {
  const res = await generate(prompt, { ...opts, json: true });
  let cleaned = res.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const a = cleaned.indexOf("{");
    const b = cleaned.lastIndexOf("}");
    if (a >= 0 && b > a) cleaned = cleaned.slice(a, b + 1);
  }
  return { ...res, data: JSON.parse(cleaned) as T };
}
