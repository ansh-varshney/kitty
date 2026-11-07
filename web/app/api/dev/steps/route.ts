import { connection } from "next/server";
import { STEPS } from "@/lib/spike/steps";
import { db } from "@/lib/db";
import { devAllowed } from "@/lib/dev-auth";

/** Lists spike steps, the latest result of each, and the latest verified webhooks. */
export async function GET(req: Request) {
  await connection();
  if (!devAllowed(req)) return Response.json({ error: "Wrong or missing dev key." }, { status: 401 });
  const d = await db();
  const latest = await d.query<{ step: string; ok: boolean; result: unknown; created_at: string }>(
    `select distinct on (step) step, ok, result, created_at from spike_runs order by step, created_at desc`,
  );
  const webhooks = await d.query<{ event_type: string; verified: boolean; received_at: string }>(
    `select event_type, verified, received_at from webhook_events order by received_at desc limit 10`,
  );
  return Response.json({
    steps: Object.entries(STEPS).map(([name, s]) => ({ name, title: s.title, auto: s.auto, latest: latest.find((l) => l.step === name) ?? null })),
    webhooks,
  });
}
