import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { getUser } from "./users";
import { localToday, validTz } from "../referee/time";
import { channel3Configured, searchProducts } from "../gifts/channel3";
import { generateJson } from "../ai/llm";
import { putOnIce } from "./pounce";

/**
 * Catnip: group birthday gifts (PRD §B14, FR-NIP-1..6, AT-18).
 * - The radar runs in the BIRTHDAY person's kitten and only if they allowed sharing (FR-NIP-1).
 * - Friends opt in; skipping is invisible (FR-NIP-2).
 * - The gift group is a squad of its own kind the birthday person is never in, so nothing about it can reach them
 *   (FR-NIP-3): no events with their user id, no squad feed they can read.
 * - Funding reuses the plan engine (FR-NIP-5). 3 days after the birthday the group is deleted; money records stay
 *   in each member's Kitten Diary (FR-NIP-6).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const RADAR_DAYS = 10;

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The next birthday on or after today (in the birthday person's zone), as YYYY-MM-DD. */
export function nextBirthday(birthDate: string, today: string): string {
  const [ty] = today.split("-").map(Number);
  const md = birthDate.slice(5, 10);
  const thisYear = `${ty}-${md === "02-29" ? "02-28" : md}`;
  return thisYear >= today ? thisYear : `${ty + 1}-${md === "02-29" ? "02-28" : md}`;
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400_000);
}

/** Job: the birthday person's kitten quietly tells their squad mates' kittens, 10 days ahead. */
export async function catnipRadar(now = new Date()) {
  const d = await db();
  const people = await d.query<{ id: string; name: string; birth_date: string; tz: string }>(
    `select id, name, birth_date::text as birth_date, tz from users where share_birthday and birth_date is not null and onboarded`,
  );
  let opened = 0;
  for (const p of people) {
    const today = localToday(validTz(p.tz), now).date;
    const bday = nextBirthday(p.birth_date, today);
    const days = daysBetween(today, bday);
    if (days < 0 || days > RADAR_DAYS) continue;
    const squads = await d.query<{ id: string; name: string }>(
      `select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 and m.left_at is null and s.kind='squad' and s.archived_at is null`,
      [p.id],
    );
    for (const s of squads) {
      const friends = await d.query<{ user_id: string }>(`select user_id from memberships where squad_id=$1 and user_id<>$2 and left_at is null`, [s.id, p.id]);
      if (friends.length < 2) continue;
      const deleteAfter = `${addDays(bday, 4)}T00:00:00Z`; // 3 full days after the birthday
      const ins = await d.query<{ id: string }>(
        `insert into gift_groups (birthday_user, origin_squad, birthday, delete_after) values ($1,$2,$3,$4)
         on conflict (birthday_user, origin_squad, birthday) do nothing returning id`,
        [p.id, s.id, bday, deleteAfter],
      );
      if (!ins.length) continue;
      opened++;
      const monthDay = new Date(`${bday}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
      for (const f of friends) {
        await d.query(`insert into gift_members (group_id, user_id) values ($1,$2)`, [ins[0].id, f.user_id]);
        // Private to each friend; never a squad event, never to the birthday person.
        await logEvent(d, { userId: f.user_id, actor: "kitten", type: "catnip.invite", objectType: "gift_group", objectId: ins[0].id, payload: { groupId: ins[0].id, text: `${p.name}'s birthday is on ${monthDay}. Join a group gift with ${s.name}? Nobody sees if you skip.` }, reason: `${p.name}'s kitten told me quietly` });
      }
    }
  }
  return { opened };
}

async function groupFor(q: Queryable, groupId: string, userId: string) {
  const [g] = await q.query<{ id: string; birthday_user: string; origin_squad: string; squad_id: string | null; birthday: string; status: string; plan_id: string | null }>(
    `select id, birthday_user, origin_squad, squad_id, birthday::text as birthday, status, plan_id from gift_groups where id=$1`,
    [groupId],
  );
  if (!g || g.status === "deleted") throw new Error("That gift group is gone.");
  if (g.birthday_user === userId) throw new Error("That gift group is gone."); // indistinguishable on purpose (FR-NIP-3)
  const [m] = await q.query<{ status: string; limit_cents: number | null }>(`select status, limit_cents from gift_members where group_id=$1 and user_id=$2`, [groupId, userId]);
  if (!m) throw new Error("That gift group is gone.");
  return { g, m };
}

/** Opt in (FR-NIP-2). The first joiner creates the secret group. */
export async function joinGift(userId: string, groupId: string, limitCents?: number) {
  const d = await db();
  const { g } = await groupFor(d, groupId, userId);
  const bday = await getUser(d, g.birthday_user);
  return d.tx(async (q) => {
    let squadId = g.squad_id;
    if (!squadId) {
      const [s] = await q.query<{ id: string }>(`insert into squads (name, kind, created_by) values ($1,'gift',$2) returning id`, [`Gift for ${bday?.name}`, userId]);
      squadId = s.id;
      await q.query(`update gift_groups set squad_id=$2, status='open' where id=$1`, [groupId, squadId]);
    }
    await q.query(`insert into memberships (squad_id, user_id) values ($1,$2) on conflict (squad_id, user_id) do update set left_at=null`, [squadId, userId]);
    await q.query(`update gift_members set status='joined', limit_cents=coalesce($3, limit_cents) where group_id=$1 and user_id=$2`, [groupId, userId, limitCents ?? null]);
    await logEvent(q, { squadId, actor: "user", actorId: userId, type: "catnip.joined", objectType: "gift_group", objectId: groupId, public: { text: "Someone joined the gift." } });
    return { ok: true, squadId };
  });
}

/** Skip: invisible to everyone (FR-NIP-2). */
export async function skipGift(userId: string, groupId: string) {
  const d = await db();
  await groupFor(d, groupId, userId);
  await d.query(`update gift_members set status='skipped' where group_id=$1 and user_id=$2 and status='invited'`, [groupId, userId]);
  return { ok: true };
}

export async function setGiftLimit(userId: string, groupId: string, limitCents: number) {
  const d = await db();
  const { m } = await groupFor(d, groupId, userId);
  if (m.status !== "joined") throw new Error("Join the gift first.");
  if (!Number.isInteger(limitCents) || limitCents < 0) throw new Error("Pick an amount.");
  await d.query(`update gift_members set limit_cents=$3 where group_id=$1 and user_id=$2`, [groupId, userId, limitCents]);
  return giftView(userId, groupId);
}

/** What a member sees: who joined, the combined budget (not each limit), ideas, the plan. */
export async function giftView(userId: string, groupId: string) {
  const d = await db();
  const { g, m } = await groupFor(d, groupId, userId);
  if (m.status !== "joined") return { group: { id: g.id, birthday: g.birthday }, joined: false };
  const bday = await getUser(d, g.birthday_user);
  const members = await d.query<{ name: string; limit_cents: number | null }>(`select u.name, gm.limit_cents from gift_members gm join users u on u.id=gm.user_id where gm.group_id=$1 and gm.status='joined'`, [groupId]);
  const ideas = await d.query<{ id: string; title: string; price_cents: number | null; url: string | null; image_url: string | null; brand: string | null; source: string; votes: string[] }>(
    `select id, title, price_cents, url, image_url, brand, source, votes from gift_ideas where group_id=$1 order by array_length(votes,1) desc nulls last, price_cents nulls last`,
    [groupId],
  );
  return {
    group: { id: g.id, for: bday?.name, birthday: g.birthday, squadId: g.squad_id, planId: g.plan_id },
    joined: true,
    joinedNames: members.map((x) => x.name),
    budgetCents: members.reduce((a, x) => a + (x.limit_cents ?? 0), 0),
    myLimitCents: m.limit_cents,
    ideas: ideas.map((i) => ({ ...i, votes: i.votes.length, iVoted: i.votes.includes(userId) })),
  };
}

/** Real gift ideas within the combined budget, from the birthday person's shared likes (FR-NIP-4). */
export async function findGiftIdeas(userId: string, groupId: string) {
  const d = await db();
  const { g } = await groupFor(d, groupId, userId);
  const view = await giftView(userId, groupId);
  const budget = ("budgetCents" in view ? view.budgetCents : 0) ?? 0;
  if (budget < 500) throw new Error("Set your gift limits first (the ideas fit the combined budget).");
  const p = await getUser(d, g.birthday_user);
  const likes = (p?.interests ?? []).slice(0, 3).join(" ");
  const gender = p?.gender === "woman" ? "female" : p?.gender === "man" ? "male" : null;
  let ideas: { title: string; priceCents: number | null; url: string | null; imageUrl: string | null; brand: string | null; source: "channel3" | "ai" }[] = [];
  if (channel3Configured()) {
    try {
      ideas = (await searchProducts({ query: `birthday gift for someone who loves ${likes}`, maxDollars: budget / 100, gender, limit: 8 })).map((x) => ({ ...x, source: "channel3" as const }));
    } catch (e) {
      console.error(`[catnip] Channel3: ${(e as Error).message}`);
    }
  }
  if (!ideas.length) {
    // No Channel3 key (or it failed): the kitten suggests ideas in words; members can add real links.
    const res = await generateJson<{ ideas?: { title: string; price_dollars: number }[] }>(
      `Suggest 4 birthday gift ideas for a friend who loves ${likes || "good times with friends"}. Total budget ${fmt(budget)}. ` +
        `Return JSON {"ideas":[{"title": short product name, "price_dollars": number within budget}]}.`,
      { tier: "fast", timeoutMs: 4000, deadlineMs: 5000 },
    ).catch(() => ({ data: { ideas: [] as { title: string; price_dollars: number }[] } }));
    ideas = (res.data.ideas ?? []).slice(0, 4).map((i) => ({ title: String(i.title).slice(0, 120), priceCents: Math.round(Number(i.price_dollars) * 100) || null, url: null, imageUrl: null, brand: null, source: "ai" as const }));
  }
  await d.tx(async (q) => {
    await q.query(`delete from gift_ideas where group_id=$1 and source <> 'member'`, [groupId]);
    for (const i of ideas.filter((x) => x.priceCents == null || x.priceCents <= budget)) {
      await q.query(`insert into gift_ideas (group_id, title, price_cents, url, image_url, brand, source) values ($1,$2,$3,$4,$5,$6,$7)`, [groupId, i.title, i.priceCents, i.url, i.imageUrl, i.brand, i.source]);
    }
  });
  return giftView(userId, groupId);
}

export async function addGiftLink(userId: string, groupId: string, input: { title: string; url?: string; priceCents?: number }) {
  const d = await db();
  const { m } = await groupFor(d, groupId, userId);
  if (m.status !== "joined") throw new Error("Join the gift first.");
  await d.query(`insert into gift_ideas (group_id, title, price_cents, url, source, added_by) values ($1,$2,$3,$4,'member',$5)`, [groupId, input.title.slice(0, 120), input.priceCents ?? null, input.url ?? null, userId]);
  return giftView(userId, groupId);
}

export async function voteGiftIdea(userId: string, ideaId: string) {
  const d = await db();
  const [i] = await d.query<{ group_id: string; votes: string[] }>(`select group_id, votes from gift_ideas where id=$1`, [ideaId]);
  if (!i) throw new Error("No such idea.");
  const { m } = await groupFor(d, i.group_id, userId);
  if (m.status !== "joined") throw new Error("Join the gift first.");
  const votes = i.votes.includes(userId) ? i.votes.filter((v) => v !== userId) : [...i.votes, userId];
  await d.query(`update gift_ideas set votes=$2 where id=$1`, [ideaId, votes]);
  return giftView(userId, i.group_id);
}

/** Turn the chosen idea into a plan in the secret group: paw in and Pounce as usual; the chooser books (FR-NIP-5). */
export async function startGiftPlan(userId: string, groupId: string, ideaId: string) {
  const d = await db();
  const { g, m } = await groupFor(d, groupId, userId);
  if (m.status !== "joined" || !g.squad_id) throw new Error("Join the gift first.");
  if (g.plan_id) throw new Error("There's already a gift plan.");
  const [idea] = await d.query<{ title: string; price_cents: number | null }>(`select title, price_cents from gift_ideas where id=$1 and group_id=$2`, [ideaId, groupId]);
  if (!idea?.price_cents) throw new Error("Pick an idea with a price.");
  const joined = await d.query<{ user_id: string }>(`select user_id from gift_members where group_id=$1 and status='joined'`, [groupId]);
  const decideBy = new Date(Math.max(Date.now() + 2 * 3600_000, Date.parse(`${g.birthday}T00:00:00Z`) - 24 * 3600_000)).toISOString();
  const plan = await d.tx(async (q) => {
    const [p] = await q.query<{ id: string }>(
      `insert into plans (squad_id, host_id, booker_id, title, price_cents, price_mode, need_at_least, pounce_rule, decide_by)
       values ($1,$2,$2,$3,$4,'total',$5,'host',$6) returning id`,
      [g.squad_id, userId, `Gift: ${idea.title}`.slice(0, 80), idea.price_cents, Math.min(2, joined.length), decideBy],
    );
    for (const j of joined) await q.query(`insert into plan_members (plan_id, user_id, status) values ($1,$2,'thinking') on conflict do nothing`, [p.id, j.user_id]);
    await q.query(`update gift_groups set plan_id=$2 where id=$1`, [groupId, p.id]);
    await logEvent(q, { squadId: g.squad_id, actor: "user", actorId: userId, type: "catnip.plan", objectType: "plan", objectId: p.id, public: { text: `The gift is chosen: ${idea.title}. Paw in to chip in.` } });
    return p;
  });
  return { planId: plan.id };
}

/** Job: delete gift groups 3 days after the birthday; money records stay in each member's Kitten Diary (FR-NIP-6). */
export async function catnipCleanup(now = new Date()) {
  const d = await db();
  const due = await d.query<{ id: string; squad_id: string | null; plan_id: string | null }>(`select id, squad_id, plan_id from gift_groups where status <> 'deleted' and delete_after < $1`, [now.toISOString()]);
  for (const g of due) {
    // A gift that was never bought goes with the group: release anything still held, then close the plan.
    // (A bought gift stays, so its money keeps its history.)
    if (g.plan_id) {
      const [p] = await d.query<{ status: string }>(`select status from plans where id=$1`, [g.plan_id]);
      if (p?.status === "open") await putOnIce(g.plan_id, "the gift group closed after the birthday");
    }
    await d.tx(async (q) => {
      if (g.plan_id) await q.query(`update plans set status='cancelled' where id=$1 and status='on_ice'`, [g.plan_id]);
      await q.query(`delete from gift_ideas where group_id=$1`, [g.id]);
      await q.query(`delete from gift_members where group_id=$1`, [g.id]);
      // Chat, ideas, votes and invites go; events that record money (a PayPal id) stay for the Diary.
      await q.query(`delete from events where object_id=$1 and type like 'catnip.%'`, [g.id]);
      if (g.squad_id) {
        await q.query(`delete from events where squad_id=$1 and paypal_id is null and (user_id is null or type like 'catnip.%')`, [g.squad_id]);
        await q.query(`update squads set archived_at=now(), name='Gift group (deleted)' where id=$1`, [g.squad_id]);
        await q.query(`update memberships set left_at=now() where squad_id=$1 and left_at is null`, [g.squad_id]);
      }
      await q.query(`update gift_groups set status='deleted' where id=$1`, [g.id]);
    });
  }
  return { deleted: due.length };
}

/** For Meows/alerts: open gift invites for this user (never shown to the birthday person). */
export async function myGiftInvites(userId: string) {
  const d = await db();
  return d.query<{ group_id: string; for_name: string; birthday: string; status: string }>(
    `select g.id as group_id, u.name as for_name, g.birthday::text as birthday, m.status from gift_members m join gift_groups g on g.id=m.group_id
     join users u on u.id=g.birthday_user where m.user_id=$1 and g.status <> 'deleted' and m.status in ('invited','joined')`,
    [userId],
  );
}
