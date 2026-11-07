import type { Queryable } from "../db";

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

export type FeedItem = { id: number; type: string; actor: string; actorId: string | null; public: Record<string, unknown>; createdAt: string };

/** What the squad sees (masked). */
export async function squadFeed(q: Queryable, squadId: string, afterId = 0, limit = 50): Promise<FeedItem[]> {
  const rows = await q.query<{ id: string; type: string; actor: string; actor_id: string | null; public: Record<string, unknown>; created_at: string }>(
    `select id, type, actor, actor_id, public, created_at from events
     where squad_id = $1 and public is not null and id > $2 order by id desc limit $3`,
    [squadId, afterId, limit],
  );
  return rows.map((r) => ({ id: Number(r.id), type: r.type, actor: r.actor, actorId: r.actor_id, public: r.public, createdAt: r.created_at }));
}

export type DiaryItem = { id: number; type: string; actor: string; payload: Record<string, unknown>; reason: string | null; paypalId: string | null; createdAt: string };

/** The owner's Kitten Diary: everything about them, with reasons and PayPal IDs (FR-LOG-2). */
export async function diary(q: Queryable, userId: string, limit = 100): Promise<DiaryItem[]> {
  const rows = await q.query<{ id: string; type: string; actor: string; payload: Record<string, unknown>; reason: string | null; paypal_id: string | null; created_at: string }>(
    `select id, type, actor, payload, reason, paypal_id, created_at from events where user_id = $1 order by id desc limit $2`,
    [userId, limit],
  );
  return rows.map((r) => ({ id: Number(r.id), type: r.type, actor: r.actor, payload: r.payload, reason: r.reason, paypalId: r.paypal_id, createdAt: r.created_at }));
}
