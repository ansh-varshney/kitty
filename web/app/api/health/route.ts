import { connection } from "next/server";
import { db } from "@/lib/db";

/** Render health check: app is up and the database answers. Shows which settings exist, never their values. */
export async function GET() {
  await connection();
  const names = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "GROQ_API_KEY", "GEMINI_API_KEY", "CHANNEL3_API_KEY", "JOBS_KEY", "DATABASE_URL", "DEV_CONSOLE_KEY", "PAYPAL_WEBHOOK_ID"];
  const settings = Object.fromEntries(names.map((n) => [n, Boolean(process.env[n])]));
  try {
    const d = await db();
    await d.query("select 1");
    // The app's own 15-minute job timer (Render only): when it last ran, so it can be checked from outside.
    const jobsTimer = ((globalThis as Record<string, unknown>).__kittyJobTimer as object | undefined) ?? null;
    return Response.json({ ok: true, db: d.kind, settings, jobsTimer });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error).message, settings }, { status: 500 });
  }
}
