import type { Queryable } from "../db";
import { describeAll } from "./describe";

/**
 * Event log (PRD §B19 Kitten Diary, FR-LOG-1, FR-SEC-5, FR-SEC-10).
 * `payload` is visible only to `userId` (its owner). `public` is what the squad sees:
 * it must never contain limits, balances, debts or reasons for declining.
 */
export type EventInput = {
  squadId?: string | null;
  userId?: string | null;
  actor: "user" | "kitten" | "system";
  actorId?: string | null;
  type: string;
  objectType?: string;
  objectId?: string | null;
  payload?: Record<string, unknown>;
  public?: Record<string, unknown> | null;
  reason?: string;
  paypalId?: string | null;
};

export async function logEvent(q: Queryable, e: EventInput): Promise<void> {
  await q.query(
    `insert into events (squad_id, user_id, actor, actor_id, type, object_type, object_id, payload, public, reason, paypal_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      e.squadId ?? null,
      e.userId ?? null,
      e.actor,
      e.actorId ?? null,
      e.type,
      e.objectType ?? null,
      e.objectId ?? null,
      JSON.stringify(e.payload ?? {}),
      e.public ? JSON.stringify(e.public) : null,
      e.reason ?? null,
      e.paypalId ?? null,
    ],
  );
}

export type FeedItem = { id: number; type: string; actor: string; actorId: string | null; mine: boolean; objectType: string | null; objectId: string | null; public: Record<string, unknown>; createdAt: string };

/** What the squad sees (masked). */
export async function squadFeed(q: Queryable, squadId: string, afterId = 0, limit = 50, viewerId?: string): Promise<FeedItem[]> {
  const rows = await q.query<{ id: string; type: string; actor: string; actor_id: string | null; object_type: string | null; object_id: string | null; public: Record<string, unknown>; created_at: string }>(
    `select id, type, actor, actor_id, object_type, object_id, public, created_at from events
     where squad_id = $1 and public is not null and id > $2 order by id desc limit $3`,
    [squadId, afterId, limit],
  );
  return rows.map((r) => ({ id: Number(r.id), type: r.type, actor: r.actor, actorId: r.public?.anonymous ? null : r.actor_id, mine: viewerId != null && r.actor_id === viewerId, objectType: r.object_type, objectId: r.object_id, public: r.public, createdAt: r.created_at }));
}

export type DiaryItem = { id: number; type: string; actor: string; payload: Record<string, unknown>; reason: string | null; paypalId: string | null; createdAt: string; objectType: string | null; objectId: string | null; squadId: string | null; line: string };

/** The owner's Kitten Diary: everything about them, in a full sentence, with reasons and PayPal IDs (FR-LOG-2). */
export async function diary(q: Queryable, userId: string, limit = 100, skipTypes: string[] = []): Promise<DiaryItem[]> {
  const rows = await q.query<{ id: string; type: string; actor: string; payload: Record<string, unknown>; reason: string | null; paypal_id: string | null; created_at: string; object_type: string | null; object_id: string | null; squad_id: string | null }>(
    `select id, type, actor, payload, reason, paypal_id, created_at, object_type, object_id, squad_id from events where user_id = $1 and type <> all($3::text[]) order by id desc limit $2`,
    [userId, limit, skipTypes],
  );
  const items = rows.map((r) => ({ id: Number(r.id), type: r.type, actor: r.actor, payload: r.payload, reason: r.reason, paypalId: r.paypal_id, createdAt: r.created_at, objectType: r.object_type, objectId: r.object_id, squadId: r.squad_id }));
  const lines = await describeAll(q, userId, items);
  return items.map((e, i) => ({ ...e, line: lines[i] }));
}
