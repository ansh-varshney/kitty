import { z } from "zod";
import { loadEnv } from "./load-env";

loadEnv();

const schema = z.object({
  PAYPAL_CLIENT_ID: z.string().min(10),
  PAYPAL_CLIENT_SECRET: z.string().min(10),
  PAYPAL_ENVIRONMENT: z.enum(["SANDBOX"]).default("SANDBOX"),
  // AI keys are optional: the kitten uses whichever are set (Groq first, then Gemini), and code fallbacks when none answer.
  GROQ_API_KEY: z.string().min(10).optional(),
  GEMINI_API_KEY: z.string().min(10).optional(),
  CHANNEL3_API_KEY: z.string().min(10).optional(), // Catnip gift search (sponsor); AI-written ideas without it
  JOBS_KEY: z.string().min(16).optional(), //         the scheduler's key: it can only run /api/v1/jobs/run
  DATABASE_URL: z.string().optional(),
  DEV_CONSOLE_KEY: z.string().min(8).optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  APP_BASE_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated server-side env. Throws a readable error listing what's missing (never the values). */
export function env(): Env {
  if (cached) return cached;
  // A blank setting means "not set" (a left-empty field on Render, or the local open dev console).
  const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}

/** The public base URL of this app (used for PayPal return URLs). */
export function baseUrl(): string {
  const e = env();
  return (e.APP_BASE_URL ?? e.RENDER_EXTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Where to send people back to after a redirect. Behind Render's proxy, req.url says http://localhost:10000 (the
 * internal port), so redirects built from it sent people to a dead page after PayPal login. On Render the public
 * address is known; locally, the browser's own Host header is.
 */
export function publicOrigin(req: Request): string {
  const e = env();
  const configured = e.APP_BASE_URL ?? e.RENDER_EXTERNAL_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const PAYPAL_API_BASE = "https://api-m.sandbox.paypal.com";
export const PAYPAL_WEB_BASE = "https://www.sandbox.paypal.com";
