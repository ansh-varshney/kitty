import { connection } from "next/server";
import { db } from "@/lib/db";
import { devAllowed } from "@/lib/dev-auth";

/** Latest results recorded when the user came back from PayPal (hold, subscription, login). */
export async function GET(req: Request) {
  await connection();
  if (!devAllowed(req)) return Response.json([], { status: 401 });
  const d = await db();
  const rows = await d.query<{ step: string; ok: boolean; result: { summary: string } }>(
    `select distinct on (step) step, ok, result from spike_runs
     where step in ('walletHoldApproved','subscriptionApproved','loginReturned')
     order by step, created_at desc`,
  );
  return Response.json(rows.map((r) => ({ step: r.step, ok: r.ok, summary: r.result?.summary ?? "" })));
}
