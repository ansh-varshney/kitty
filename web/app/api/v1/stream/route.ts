import { connection } from "next/server";
import { db } from "@/lib/db";
import { requestUserId } from "@/lib/session";

/**
 * Live updates for the app (PRD §D8 Phase 1: "SSE, polling the events table every ~1.5 s").
 * The user gets their own events in full and their squads' events masked (public part only).
 * The stream closes after a few minutes; EventSource reconnects with Last-Event-ID.
 */
export async function GET(req: Request) {
  await connection();
  const userId = requestUserId(req);
  if (!userId) return new Response("Log in first.", { status: 401 });
  const d = await db();
  const start = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after") ?? 0) || 0;
  let last = start;
  if (!last) {
    const [r] = await d.query<{ m: string | null }>(`select max(id) as m from events`);
    last = Number(r?.m ?? 0);
  }
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        controller.close();
      };
      send(`retry: 1500\n: hello\n\n`);
      const startedAt = Date.now();
      let busy = false;
      timer = setInterval(async () => {
        if (busy || closed) return;
        busy = true;
        try {
          const rows = await d.query<{ id: string; type: string; user_id: string | null; squad_id: string | null; actor: string; payload: unknown; public: unknown; created_at: string }>(
            `select e.id, e.type, e.user_id, e.squad_id, e.actor, e.payload, e.public, e.created_at from events e
             where e.id > $2 and (e.user_id = $1 or (e.public is not null and e.squad_id in
               (select squad_id from memberships where user_id = $1 and left_at is null)))
             order by e.id limit 100`,
            [userId, last],
          );
          for (const r of rows) {
            const mine = r.user_id === userId;
            const data = { id: Number(r.id), type: r.type, actor: r.actor, squadId: r.squad_id, mine, payload: mine ? r.payload : undefined, public: r.public ?? undefined, createdAt: r.created_at };
            send(`id: ${r.id}\nevent: kitty\ndata: ${JSON.stringify(data)}\n\n`);
            last = Number(r.id);
          }
          if (!rows.length) send(`: ping\n\n`);
          if (Date.now() - startedAt > 4 * 60_000) close();
        } catch {
          close();
        } finally {
          busy = false;
        }
      }, 1500);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
}
