import { GoogleGenAI } from "@google/genai";
import { env } from "../env";

/**
 * Gemini client, speed first (PRD §C2, FR-AI-1/2):
 * - "fast" tasks use Flash-Lite first, then Flash
 * - "vision" / complex parsing use Flash first, then Flash-Lite
 * - retries 429/503 with backoff, then falls through to the next model,
 *   and finally to a caller-supplied template so the app never breaks.
 */

export const MODELS = {
  fast: ["gemini-3.1-flash-lite", "gemini-3.5-flash"],
  smart: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
} as const;

export type Tier = keyof typeof MODELS;

type Generate = (model: string, prompt: string, opts: { json: boolean; system?: string; timeoutMs: number }) => Promise<string>;

let ai: GoogleGenAI | undefined;
const realGenerate: Generate = async (model, prompt, opts) => {
  ai ??= new GoogleGenAI({ apiKey: env().GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      ...(opts.system ? { systemInstruction: opts.system } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
      abortSignal: AbortSignal.timeout(opts.timeoutMs),
    },
  });
  const text = res.text;
  if (!text) throw new Error("Empty response from Gemini");
  return text;
};

function isRetryable(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err);
  const status = (err as { status?: number })?.status;
  return status === 429 || status === 503 || status === 500 || /429|503|500|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|timeout|aborted/i.test(msg);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type GenResult = { text: string; model: string; fallback: boolean; attempts: number };

export async function generate(
  prompt: string,
  opts: { tier?: Tier; json?: boolean; system?: string; timeoutMs?: number; template?: () => string; impl?: Generate } = {},
): Promise<GenResult> {
  const chain = MODELS[opts.tier ?? "fast"];
  const impl = opts.impl ?? realGenerate;
  let attempts = 0;
  let lastErr: unknown;
  for (const model of chain) {
    for (let i = 0; i < 2; i++) {
      attempts++;
      try {
        const text = await impl(model, prompt, { json: opts.json ?? false, system: opts.system, timeoutMs: opts.timeoutMs ?? 12_000 });
        return { text, model, fallback: false, attempts };
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err)) break; // e.g. 404 model retired: move to the next model
        await sleep(300 * 2 ** i);
      }
    }
  }
  if (opts.template) return { text: opts.template(), model: "template", fallback: true, attempts };
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** JSON helper: parses the model output; the caller validates it with zod (FR-AI-3). */
export async function generateJson<T>(prompt: string, opts: Parameters<typeof generate>[1] = {}): Promise<{ data: T } & GenResult> {
  const res = await generate(prompt, { ...opts, json: true });
  return { ...res, data: JSON.parse(res.text) as T };
}
