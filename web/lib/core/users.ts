import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Queryable } from "../db";
import { logEvent } from "./events";
import { mapRule } from "../kitten/ai";
import type { Rule, RuleType } from "../referee/rules";
import { validTz } from "../referee/time";
import { ACCESSORIES, EYES, FURS, PATTERNS } from "../kitten/looks";

/** Users, kittens, sign-up, House Rules and squads (PRD §B1–B3, §B5). */

export type User = {
  id: string;
  name: string;
  paypal_email: string | null;
  email_verified: boolean;
  gender: string | null;
  birth_date: string | null;
  share_birthday: boolean;
  interests: string[];
  onboarded: boolean;
  is_demo: boolean;
  availability: Record<string, unknown>;
  tz: string;
};
export type Kitten = { user_id: string; name: string; breed: string; look: Record<string, unknown>; memory: unknown[] };

export const BREEDS = ["siamese", "persian", "tabby", "bengal", "ragdoll", "shorthair"] as const;
export const GENDERS = ["woman", "man", "non-binary", "prefer not to say"] as const;
export const INTEREST_OPTIONS = ["food", "travel", "concerts", "sports", "outdoors", "games", "movies", "nightlife", "shopping", "wellness"];

export async function getUser(q: Queryable, id: string): Promise<User | null> {
  const [u] = await q.query<User>(`select * from users where id = $1`, [id]);
  return u ?? null;
}

export async function getKitten(q: Queryable, userId: string): Promise<Kitten | null> {
  const [k] = await q.query<Kitten>(`select * from kittens where user_id = $1`, [userId]);
  return k ?? null;
}

/** Log in with PayPal → find or create the user (FR-ONB-1). The verified email is the payout address. */
export async function upsertPayPalUser(q: Queryable, p: { payerId: string; name?: string; email?: string; emailVerified?: boolean }): Promise<User> {
  const [u] = await q.query<User>(
    `insert into users (paypal_payer_id, name, paypal_email, email_verified)
     values ($1, $2, $3, $4)
     on conflict (paypal_payer_id) do update set paypal_email = coalesce(excluded.paypal_email, users.paypal_email),
       email_verified = excluded.email_verified
     returning *`,
    [p.payerId, p.name ?? "New friend", p.email ?? null, p.emailVerified ?? false],
  );
  return u;
}

export const OnboardingInput = z.object({
  name: z.string().min(1).max(40),
  gender: z.enum(GENDERS),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shareBirthday: z.boolean(),
  interests: z.array(z.string().min(2).max(30)).min(3).max(12),
  /** The phone's time zone (Intl), so "7pm" means 7pm where they are. */
  tz: z.string().max(60).optional(),
  kitten: z.object({
    name: z.string().min(1).max(20),
    breed: z.enum(BREEDS),
    // The owner picks only the look (§B1 page 3); mood and pose are set by what the kitten does (lib/kitten/moments.ts).
    look: z.object({ fur: z.enum(FURS), pattern: z.enum(PATTERNS), accessory: z.enum(ACCESSORIES), eyes: z.enum(EYES).default("amber") }),
  }),
  rules: z.object({
    funBudgetCents: z.number().int().min(0).max(1_000_000),
    freeHandCents: z.number().int().min(0).max(100_000),
    helpCents: z.number().int().min(0).max(100_000),
  }),
});

/** Sign-up pages 2–4 in one call (FR-ONB-2/3). The Treat Jar and the squad are their own calls. */
export async function completeOnboarding(q: Queryable, userId: string, raw: unknown): Promise<void> {
  const i = OnboardingInput.parse(raw);
  await q.query(
    `update users set name=$2, gender=$3, birth_date=$4, share_birthday=$5, interests=$6, tz=$7, onboarded=true where id=$1`,
    [userId, i.name, i.gender, i.birthDate, i.shareBirthday, i.interests, validTz(i.tz)],
  );
  await q.query(
    `insert into kittens (user_id, name, breed, look) values ($1,$2,$3,$4)
     on conflict (user_id) do update set name=excluded.name, breed=excluded.breed, look=excluded.look`,
    [userId, i.kitten.name, i.kitten.breed, JSON.stringify(i.kitten.look)],
  );
  await setBasicRules(q, userId, i.rules);
  await logEvent(q, { userId, actor: "user", actorId: userId, type: "kitten.adopted", payload: { kitten: i.kitten.name, breed: i.kitten.breed } });
}

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

export async function setBasicRules(q: Queryable, userId: string, r: { funBudgetCents: number; freeHandCents: number; helpCents: number }) {
  const basics: [RuleType, Record<string, unknown>, string][] = [
    ["R1", { cents: r.funBudgetCents }, `Fun budget: ${money(r.funBudgetCents)} a month on friends`],
    ["R2", { cents: r.freeHandCents }, `Free hand: up to ${money(r.freeHandCents)} at a time from my Treat Jar`],
    ["R3", { cents: r.helpCents }, `Help: suggest up to ${money(r.helpCents)} when a friend needs a hand`],
    ["R4", { availability: true, attendance: true, interests: true }, "Share: availability, attendance, interests. Money: never"],
  ];
  for (const [type, params, text] of basics) {
    await q.query(`delete from rules where user_id=$1 and squad_id is null and type=$2`, [userId, type]);
    await q.query(`insert into rules (user_id, type, params, text) values ($1,$2,$3,$4)`, [userId, type, JSON.stringify(params), text]);
  }
}

export async function listRules(q: Queryable, userId: string): Promise<(Rule & { id: string; text: string })[]> {
  const rows = await q.query<{ id: string; type: RuleType; squad_id: string | null; params: Record<string, unknown>; text: string; active: boolean }>(
    `select id, type, squad_id, params, text, active from rules where user_id=$1 order by created_at`,
    [userId],
  );
  return rows.map((r) => ({ id: r.id, type: r.type, squadId: r.squad_id, params: r.params, text: r.text, active: r.active }));
}

/** "Add your own rule" (FR-RULE-4/5/6): map to a type, flag conflicts, save. */
export async function addCustomRule(q: Queryable, userId: string, text: string, squadId: string | null = null) {
  const mapped = await mapRule(text);
  if ("error" in mapped) return { ok: false as const, error: mapped.error };
  const existing = await listRules(q, userId);
  const conflict = existing.find((r) => r.type === mapped.type && (r.squadId ?? null) === squadId && ["R1", "R2", "R3"].includes(mapped.type));
  if (conflict) {
    await q.query(`update rules set params=$2, text=$3 where id=$1`, [conflict.id, JSON.stringify(mapped.params), mapped.plain]);
  } else {
    await q.query(`insert into rules (user_id, squad_id, type, params, text) values ($1,$2,$3,$4,$5)`, [
      userId,
      squadId,
      mapped.type,
      JSON.stringify(mapped.params),
      mapped.plain,
    ]);
  }
  await logEvent(q, { userId, actor: "kitten", type: "rule.added", payload: { type: mapped.type, plain: mapped.plain, replaced: Boolean(conflict) }, reason: "you typed a rule" });
  return { ok: true as const, type: mapped.type, plain: mapped.plain, replaced: conflict?.text ?? null };
}

// ---------------------------------------------------------------- squads

export async function createSquad(q: Queryable, ownerId: string, name: string, opts: { kind?: "squad" | "mini" | "direct"; memberIds?: string[] } = {}) {
  const code = randomBytes(5).toString("base64url");
  const [s] = await q.query<{ id: string }>(`insert into squads (name, kind, created_by, invite_code) values ($1,$2,$3,$4) returning id`, [
    name,
    opts.kind ?? "squad",
    ownerId,
    code,
  ]);
  await q.query(`insert into memberships (squad_id, user_id, role) values ($1,$2,'admin')`, [s.id, ownerId]);
  for (const m of opts.memberIds ?? []) {
    if (m !== ownerId) await q.query(`insert into memberships (squad_id, user_id) values ($1,$2) on conflict do nothing`, [s.id, m]);
  }
  await logEvent(q, { squadId: s.id, actor: "user", actorId: ownerId, type: "squad.created", public: { name, kind: opts.kind ?? "squad" } });
  return { id: s.id, inviteCode: code };
}

/** Two friends' private pair: what a one-to-one plan belongs to. Reused every time, and never shown as a squad. */
export async function directSquad(q: Queryable, ownerId: string, friendId: string): Promise<{ id: string }> {
  const [found] = await q.query<{ id: string }>(
    `select s.id from squads s join memberships a on a.squad_id=s.id and a.user_id=$1 join memberships b on b.squad_id=s.id and b.user_id=$2 where s.kind='direct' limit 1`,
    [ownerId, friendId],
  );
  if (found) return found;
  const people = await q.query<{ id: string; name: string }>(`select id, name from users where id = any($1::uuid[])`, [[ownerId, friendId]]);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "A friend";
  return createSquad(q, ownerId, `${nameOf(ownerId)} & ${nameOf(friendId)}`.slice(0, 40), { kind: "direct", memberIds: [friendId] });
}

/** A pasted invite link or a bare code: either way, the code. */
export const inviteCodeIn = (text: string) => (/[?&]invite=([^&\s#]+)/.exec(text)?.[1] ?? text).trim();

export async function joinSquad(q: Queryable, userId: string, code: string) {
  const [s] = await q.query<{ id: string; name: string }>(`select id, name from squads where invite_code=$1 and archived_at is null`, [inviteCodeIn(code)]);
  if (!s) throw new Error("That invite link doesn't work any more.");
  const joined = await q.query(`insert into memberships (squad_id, user_id) values ($1,$2) on conflict (squad_id, user_id) do update set left_at=null where memberships.left_at is not null returning user_id`, [s.id, userId]);
  if (joined.length) await logEvent(q, { squadId: s.id, actor: "user", actorId: userId, type: "squad.joined", public: { userId } });
  return s;
}

export async function isMember(q: Queryable, squadId: string, userId: string): Promise<boolean> {
  const r = await q.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [squadId, userId]);
  return r.length > 0;
}

export async function squadMembers(q: Queryable, squadId: string) {
  return q.query<{ id: string; name: string; kitten_name: string | null; kitten_look: Record<string, unknown> | null; role: string }>(
    `select u.id, u.name, k.name as kitten_name, k.look as kitten_look, m.role from memberships m join users u on u.id=m.user_id
     left join kittens k on k.user_id=u.id where m.squad_id=$1 and m.left_at is null order by m.joined_at`,
    [squadId],
  );
}

export async function mySquads(q: Queryable, userId: string) {
  return q.query<{ id: string; name: string; kind: string; invite_code: string }>(
    `select s.id, s.name, s.kind, s.invite_code from squads s join memberships m on m.squad_id=s.id
     where m.user_id=$1 and m.left_at is null and s.archived_at is null and s.kind <> 'direct' order by s.created_at`,
    [userId],
  );
}

/** Change the kitten's look, name or personality (My Kitten, F44). Never its rules or money behaviour (FR-ONB-4). */
export async function updateKitten(q: Queryable, userId: string, raw: unknown) {
  const i = OnboardingInput.shape.kitten.parse(raw);
  await q.query(`update kittens set name=$2, breed=$3, look=$4 where user_id=$1`, [userId, i.name, i.breed, JSON.stringify(i.look)]);
}

/** Edit what sign-up collected (My Kitten, FR-ONB-5). */
export async function updateProfile(q: Queryable, userId: string, raw: unknown) {
  const i = z
    .object({ name: z.string().min(1).max(40), gender: z.enum(GENDERS), birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), shareBirthday: z.boolean(), interests: z.array(z.string().min(2).max(30)).min(3).max(12) })
    .parse(raw);
  await q.query(`update users set name=$2, gender=$3, birth_date=$4, share_birthday=$5, interests=$6 where id=$1`, [userId, i.name, i.gender, i.birthDate, i.shareBirthday, i.interests]);
}

/** What friends' kittens may say about you (R4). Money isn't a choice: it's never shared (FR-RULE-8). */
export async function setSharing(q: Queryable, userId: string, raw: unknown) {
  const i = z.object({ availability: z.boolean(), attendance: z.boolean(), interests: z.boolean() }).parse(raw);
  const on = Object.entries(i).filter(([, v]) => v).map(([k]) => k);
  await q.query(`update rules set params=$2, text=$3 where user_id=$1 and type='R4' and squad_id is null`, [userId, JSON.stringify(i), `Share: ${on.join(", ") || "nothing"}. Money: never`]);
}

/** Remove one of your own rules or a squad rule. The Basics stay: they can only be changed. */
export async function deleteRule(q: Queryable, userId: string, ruleId: string) {
  const r = await q.query(`update rules set active=false where id=$1 and user_id=$2 and type not in ('R1','R2','R3','R4') returning id`, [ruleId, userId]);
  if (!r.length) throw new Error("That rule can't be removed.");
}

/** What the kitten remembers (FR-KIT-6): viewable and deletable. */
export async function kittenMemory(q: Queryable, userId: string): Promise<string[]> {
  const [k] = await q.query<{ memory: unknown }>(`select memory from kittens where user_id=$1`, [userId]);
  return Array.isArray(k?.memory) ? (k.memory as unknown[]).map(String) : [];
}
export async function setKittenMemory(q: Queryable, userId: string, memory: string[]) {
  await q.query(`update kittens set memory=$2 where user_id=$1`, [userId, JSON.stringify(memory.slice(-100))]);
}

/** "Keep as squad": turn an archived mini-squad into a regular squad (FR-SQD-6). */
export async function keepAsSquad(q: Queryable, userId: string, squadId: string, name?: string) {
  if (!(await isMember(q, squadId, userId))) throw new Error("You're not in that group.");
  await q.query(`update squads set kind='squad', archived_at=null, name=coalesce($2, name) where id=$1`, [squadId, name ?? null]);
}

/** Friends = anyone who shares a squad with you (mini-squads only take friends, FR-SQD-6). */
export async function sharesASquad(q: Queryable, a: string, b: string): Promise<boolean> {
  const r = await q.query(
    `select 1 from memberships x join memberships y on x.squad_id=y.squad_id
     where x.user_id=$1 and y.user_id=$2 and x.left_at is null and y.left_at is null limit 1`,
    [a, b],
  );
  return r.length > 0;
}
