import { connection } from "next/server";
import { calendarFeed } from "@/lib/core/export";

/** Private calendar feed for Google/Apple/Outlook (PRD §B21 FR-EXP-2). The unguessable token is the only key. */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await ctx.params;
  const body = await calendarFeed(token.replace(/\.ics$/, ""));
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, max-age=300" } });
}
