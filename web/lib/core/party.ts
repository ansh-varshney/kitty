import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, balance, move } from "./ledger";
import { getUser, isMember } from "./users";
import { payOut } from "./money-flow";
import { jarBalances } from "./month";
import { paypalRequest } from "../paypal/rest";
import { withLock } from "./locks";
import { nextDayOfMonth, ordinal, validTz } from "../referee/time";

/**
 * Kitty Party: a squad's shared savings (PRD §B13, FR-PARTY-1..8, AT-24). One party per squad. Each member saves
 * their OWN monthly amount, moved from their Treat Jar on a day of the month they pick. If the jar is short the saving
 * waits and the kitten asks for a top-up. Every member's balance is tracked separately in the ledger
 * (savings:{squad}:{user}); the jar total is always the sum of them.
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

type PartyRow = { id: string; squad_id: string; name: string; goal_cents: number | null; interval_unit: string };

async function partyBySquad(q: Queryable, squadId: string) {
  const [p] = await q.query<PartyRow>(`select * from parties where squad_id=$1`, [squadId]);
  return p ?? null;
}

export async function createParty(userId: string, squadId: string, input: { name: string; goalCents: number; intervalUnit?: "DAY" | "WEEK" | "MONTH" }) {
  const d = await db();
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  if (await partyBySquad(d, squadId)) throw new Error("This squad already has a Kitty Party.");
  const [p] = await d.query<{ id: string }>(
    `insert into parties (squad_id, name, goal_cents, interval_unit, created_by) values ($1,$2,$3,$4,$5) returning id`,
    [squadId, input.name.slice(0, 40), input.goalCents, input.intervalUnit ?? "MONTH", userId],
  );
  await logEvent(d, { squadId, actor: "user", actorId: userId, type: "party.created", objectType: "party", objectId: p.id, public: { text: `A Kitty Party started: ${input.name} (goal ${fmt(input.goalCents)}). Join with your own monthly amount.` } });
  return { partyId: p.id };
}

/** Join (or change) with my own monthly amount and the day it moves (FR-PARTY-1, FR-PARTY-7, rule R6). */
export async function joinParty(userId: string, squadId: string, monthlyCents: number, saveDay?: number) {
  const d = await db();
  const party = await partyBySquad(d, squadId);
  if (!party) throw new Error("This squad has no Kitty Party yet.");
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  if (!Number.isInteger(monthlyCents) || monthlyCents < 100 || monthlyCents % 100 !== 0) throw new Error("Pick whole dollars, at least $1.");
  if (saveDay !== undefined && (!Number.isInteger(saveDay) || saveDay < 1 || saveDay > 28)) throw new Error("Pick a day from 1 to 28.");
  return withLock(`party:${party.id}:${userId}`, () => joinPartyNow(userId, squadId, party, monthlyCents, saveDay));
}

async function joinPartyNow(userId: string, squadId: string, party: PartyRow, monthlyCents: number, saveDay?: number) {
  const d = await db();
  const now = new Date();
  const user = await getUser(d, userId);
  const tz = validTz(user?.tz);
  const [was] = await d.query<{ status: string; subscription_id: string | null; save_day: number | null; next_save_at: string | null }>(
    `select status, subscription_id, save_day, next_save_at from party_members where party_id=$1 and user_id=$2`,
    [party.id, userId],
  );
  const day = saveDay ?? was?.save_day ?? null;
  // Changing the amount isn't a new saving: the next one just uses it. Only a new day moves the date.
  const keep = was?.status === "active" && was.next_save_at && was.save_day === day;
  const nextAt = keep ? new Date(was.next_save_at!) : day ? nextDayOfMonth(day, tz, now) : now;
  // Anyone who joined when savings were a PayPal subscription: end it, so they aren't charged twice.
  if (was?.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${was.subscription_id}/cancel`, { body: { reason: "Now saving from the Treat Jar" } }).catch(() => undefined);
  const unit = party.interval_unit.toLowerCase();
  await d.tx(async (q) => {
    await q.query(`delete from rules where user_id=$1 and squad_id=$2 and type='R6'`, [userId, squadId]);
    await q.query(`insert into rules (user_id, squad_id, type, params, text) values ($1,$2,'R6',$3,$4)`, [userId, squadId, JSON.stringify({ cents: monthlyCents, partyId: party.id, day }), `Save ${fmt(monthlyCents)} a ${unit} into ${party.name}, from my Treat Jar${day ? `, on the ${ordinal(day)}` : ""}`]);
    await q.query(
      `insert into party_members (party_id, user_id, monthly_cents, save_day, next_save_at, status) values ($1,$2,$3,$4,$5,'active')
       on conflict (party_id, user_id) do update set monthly_cents=excluded.monthly_cents, save_day=excluded.save_day, next_save_at=excluded.next_save_at, subscription_id=null, approve_url=null, status='active'`,
      [party.id, userId, monthlyCents, day, nextAt.toISOString()],
    );
    await logEvent(q, { userId, squadId, actor: "user", actorId: userId, type: "party.joined", objectType: "party", objectId: party.id, payload: { cents: monthlyCents, day, text: `You'll save ${fmt(monthlyCents)} a ${unit} into ${party.name} from your Treat Jar${day ? `, on the ${ordinal(day)}` : ""}.` } });
  });
  const first = nextAt <= now ? await saveNow(party, userId, now) : null;
  return { ok: true, status: "active", changed: Boolean(keep), nextSaveAt: nextAt.toISOString(), first };
}

/** What a saving changes besides the money itself: the counters, the saver's Diary and the squad's jar. */
async function noteSaving(q: Queryable, party: PartyRow, userId: string, cents: number, paypalId: string | null, from: string) {
  await q.query(`update party_members set collected_count=collected_count+1, last_collected_at=now(), payment_failed_at=null where party_id=$1 and user_id=$2`, [party.id, userId]);
  const mine = await balance(q, acct.savings(party.squad_id, userId));
  const jar = await jarTotal(q, party.squad_id);
  await logEvent(q, { userId, squadId: party.squad_id, actor: "kitten", type: "party.saved", objectType: "party", objectId: party.id, payload: { cents, balanceCents: mine, text: `Saved ${fmt(cents)}${from} into ${party.name}. Your savings there: ${fmt(mine)}.` }, paypalId });
  await logEvent(q, { squadId: party.squad_id, actor: "system", type: "party.jar", objectType: "party", objectId: party.id, public: { text: `${party.name} jar: ${fmt(jar)}${party.goal_cents ? ` of ${fmt(party.goal_cents)}` : ""}.`, jarCents: jar, goalCents: party.goal_cents } });
}

const nextDue = (party: PartyRow, day: number | null, tz: string, now: Date) =>
  party.interval_unit === "DAY" ? new Date(now.getTime() + 86400_000) : party.interval_unit === "WEEK" ? new Date(now.getTime() + 7 * 86400_000) : nextDayOfMonth(day ?? 1, tz, now, { afterToday: true });

/** Short on the day: the saving waits, and the kitten asks for a top-up, at most once in 3 days (FR-PARTY-8). */
async function askForTopUp(party: PartyRow, userId: string, cents: number, availableCents: number) {
  const d = await db();
  const asked = await d.query(
    `update party_members set payment_failed_at=now() where party_id=$1 and user_id=$2 and (payment_failed_at is null or payment_failed_at < now() - interval '3 days') returning user_id`,
    [party.id, userId],
  );
  if (!asked.length) return;
  const shortCents = cents - availableCents;
  await logEvent(d, { userId, squadId: party.squad_id, actor: "kitten", type: "party.payment_failed", objectType: "party", objectId: party.id, payload: { cents, shortCents, text: `Your Treat Jar was ${fmt(shortCents)} short for your ${fmt(cents)} into ${party.name}. No penalty.` }, reason: "there wasn't enough in your Treat Jar on your saving day" });
}

/** One saving: from the saver's Treat Jar straight into their own savings. Callers hold the saver's lock. */
async function saveNow(party: PartyRow, userId: string, now = new Date()) {
  const d = await db();
  const [m] = await d.query<{ monthly_cents: number; status: string; save_day: number | null }>(`select monthly_cents, status, save_day from party_members where party_id=$1 and user_id=$2`, [party.id, userId]);
  if (!m || m.status !== "active") throw new Error("Not an active saver.");
  const { availableCents } = await jarBalances(d, userId);
  if (availableCents < m.monthly_cents) {
    await askForTopUp(party, userId, m.monthly_cents, availableCents);
    return { saved: false as const, shortCents: m.monthly_cents - availableCents };
  }
  const user = await getUser(d, userId);
  const next = nextDue(party, m.save_day, validTz(user?.tz), now);
  await d.tx(async (q) => {
    await move(q, acct.jar(userId), acct.savings(party.squad_id, userId), m.monthly_cents, { kind: "savings_contribution", userId, reason: `${party.name} saving, from your Treat Jar` });
    await q.query(`update party_members set next_save_at=$3 where party_id=$1 and user_id=$2`, [party.id, userId, next.toISOString()]);
    await noteSaving(q, party, userId, m.monthly_cents, null, " from your Treat Jar");
  });
  return { saved: true as const, cents: m.monthly_cents };
}

/** Save one cycle now, whatever the date (dev tools and tests). */
export async function collectContribution(partyId: string, userId: string) {
  const d = await db();
  const [party] = await d.query<PartyRow>(`select * from parties where id=$1`, [partyId]);
  if (!party) throw new Error("No Kitty Party here.");
  return withLock(`party:${partyId}:${userId}`, () => saveNow(party, userId));
}

/** Only for anyone who joined when savings were a PayPal subscription: money PayPal did take still counts. */
export async function creditFromWebhook(subscriptionId: string, cents: number, saleId: string) {
  const d = await db();
  const [m] = await d.query<{ party_id: string; user_id: string }>(`select party_id, user_id from party_members where subscription_id=$1`, [subscriptionId]);
  if (!m) return false;
  const [party] = await d.query<PartyRow>(`select * from parties where id=$1`, [m.party_id]);
  return d.tx(async (q) => {
    if ((await q.query(`select 1 from ledger where paypal_id=$1 and kind='savings_contribution' limit 1`, [saleId])).length) return false; // a webhook delivered twice credits once
    await move(q, acct.world, acct.savings(party.squad_id, m.user_id), cents, { kind: "savings_contribution", userId: m.user_id, paypalId: saleId, reason: `${party.name} saving` });
    await noteSaving(q, party, m.user_id, cents, saleId, "");
    return true;
  });
}

export async function jarTotal(q: Queryable, squadId: string) {
  const [r] = await q.query<{ c: string | null }>(
    `select coalesce(sum(amount_cents),0) as c from ledger where account like $1 or account like $2`,
    [`savings:${squadId}:%`, `savings_held:${squadId}:%`],
  );
  return Number(r.c ?? 0);
}

/** Each member's own balance (savings + reserved for a plan), FR-PARTY-6. */
export async function memberBalances(q: Queryable, squadId: string) {
  const rows = await q.query<{ account: string; c: string }>(
    `select account, sum(amount_cents) as c from ledger where account like $1 or account like $2 group by account`,
    [`savings:${squadId}:%`, `savings_held:${squadId}:%`],
  );
  const by: Record<string, number> = {};
  for (const r of rows) {
    const userId = r.account.split(":").pop()!;
    by[userId] = (by[userId] ?? 0) + Number(r.c);
  }
  return by;
}

/** The party as one member sees it: one shared jar and goal, what each person puts in a month, and only their OWN balance (FR-PARTY-2). */
export async function partyView(userId: string, squadId: string) {
  const d = await db();
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  const party = await partyBySquad(d, squadId);
  if (!party) return { party: null };
  const jar = await jarTotal(d, squadId);
  const members = await d.query<{ name: string; status: string; monthly_cents: number }>(`select u.name, m.status, m.monthly_cents from party_members m join users u on u.id=m.user_id where m.party_id=$1 order by m.joined_at`, [party.id]);
  const [mine] = await d.query<{ monthly_cents: number; status: string; collected_count: number; save_day: number | null; next_save_at: string | null }>(`select monthly_cents, status, collected_count, save_day, next_save_at from party_members where party_id=$1 and user_id=$2`, [party.id, userId]);
  return {
    party: { id: party.id, name: party.name, goalCents: party.goal_cents, interval: party.interval_unit },
    jarCents: jar,
    goalPct: party.goal_cents ? Math.min(100, Math.round((jar / party.goal_cents) * 100)) : null,
    savers: members.filter((m) => m.status === "active").map((m) => ({ name: m.name, monthlyCents: m.monthly_cents })),
    myJarCents: (await jarBalances(d, userId)).availableCents,
    mine: mine ? { ...mine, balanceCents: (await memberBalances(d, squadId))[userId] ?? 0 } : null,
  };
}

/** Take my own savings back (FR-PARTY-4). */
export async function withdrawSavings(userId: string, squadId: string, cents?: number) {
  // One at a time per person: a double tap must not pay out twice (the ledger also refuses to go below $0).
  return withLock(`savings:${squadId}:${userId}`, () => withdrawSavingsNow(userId, squadId, cents));
}

async function withdrawSavingsNow(userId: string, squadId: string, cents?: number) {
  const d = await db();
  const available = await balance(d, acct.savings(squadId, userId));
  const amount = cents ?? available;
  if (!Number.isInteger(amount) || amount <= 0 || amount > available) throw new Error(`You can withdraw up to ${fmt(available)}.`);
  const batch = await d.tx((q) => payOut(q, userId, amount, acct.savings(squadId, userId), { note: "Kitty Party savings withdrawal", itemId: `save-${userId.slice(0, 8)}`, kind: "savings_withdraw" }));
  if (!batch) throw new Error("PayPal couldn't send the money just now. Try again soon.");
  await logEvent(d, { userId, squadId, actor: "user", actorId: userId, type: "party.withdrawn", payload: { cents: amount, text: `${fmt(amount)} of your savings is on its way to your PayPal.` }, paypalId: batch });
  return { ok: true, cents: amount, payoutBatchId: batch };
}

/** Stop (or pause) my monthly saving; my balance stays mine (FR-PARTY-4). */
export async function stopSaving(userId: string, squadId: string) {
  const d = await db();
  const party = await partyBySquad(d, squadId);
  if (!party) throw new Error("No Kitty Party here.");
  const [m] = await d.query<{ subscription_id: string | null }>(`update party_members set status='stopped' where party_id=$1 and user_id=$2 returning subscription_id`, [party.id, userId]);
  if (m?.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${m.subscription_id}/cancel`, { body: { reason: "Stopped saving in Kitty" } }).catch(() => undefined);
  await d.query(`update rules set active=false where user_id=$1 and squad_id=$2 and type='R6'`, [userId, squadId]);
  return { ok: true };
}

async function saveEach(rows: { party_id: string; user_id: string }[], now: Date) {
  const d = await db();
  let collected = 0;
  for (const r of rows) {
    try {
      const [party] = await d.query<PartyRow>(`select * from parties where id=$1`, [r.party_id]);
      await withLock(`party:${r.party_id}:${r.user_id}`, async () => {
        // Another run may have got here first: look again now that this one holds the lock.
        const [still] = await d.query(`select 1 as x from party_members where party_id=$1 and user_id=$2 and status='active' and next_save_at <= $3`, [r.party_id, r.user_id, now.toISOString()]);
        if (still && (await saveNow(party, r.user_id, now)).saved) collected++;
      });
    } catch (e) {
      console.error(`[party] saving failed: ${(e as Error).message}`);
    }
  }
  return collected;
}

/** Job: every saving whose day has come. Short ones stay due, so a later run picks them up. */
export async function partyJobs(now = new Date()) {
  const d = await db();
  const due = await d.query<{ party_id: string; user_id: string }>(`select party_id, user_id from party_members where status='active' and next_save_at <= $1`, [now.toISOString()]);
  return { collected: await saveEach(due, now) };
}

/** After a Treat Jar top-up: whatever was waiting on it goes in straight away (FR-PARTY-8). */
export async function saveDueFor(userId: string, now = new Date()) {
  const d = await db();
  const due = await d.query<{ party_id: string; user_id: string }>(`select party_id, user_id from party_members where user_id=$1 and status='active' and next_save_at <= $2`, [userId, now.toISOString()]);
  return saveEach(due, now);
}
