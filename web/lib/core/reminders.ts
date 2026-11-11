import { db } from "../db";
import { logEvent } from "./events";
import { afterDays, afterHours, beforeDeadline, CARD_DAYS, inQuietHours, MIN_GAP_MS, nextRound, PAY_DAYS, PLAN_HOURS_LEFT, PLAN_MIN_AGE_MS, RECEIPT_HOURS } from "../referee/reminders";
import { validTz } from "../referee/time";

/**
 * Kittens do the chasing (PRD §B11, FR-REMIND-1..4): nobody has to ask a friend for money or nudge them to answer.
 * Each reminder is private, waits for the person's quiet hours, is sent once per round, and shows up in Meows as a
 * one-tap card in the sending kitten's voice. The person owed is told their kitten is on it and does nothing.
 */

type Db = Awaited<ReturnType<typeof db>>;
type Kind = "yarn_pay" | "card_confirm" | "plan_paw" | "receipt" | "owed_note" | "whim_answer";
type Person = { id: string; name: string; tz: string; quiet_start: string; quiet_end: string; kitten: string | null; breed: string | null };
type Send = {
  kind: Kind;
  objectId: string;
  objectType: string;
  userId: string;
  round: number;
  text: string;
  type: string;
  reason: string;
  fromUser?: string;
  squadId?: string;
  payload?: Record<string, unknown>;
};

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Tone by breed (§B3: how a kitten reminds others). The words stay plain and never pressure (FR-KIT-7). */
const OPENER: Record<string, string> = { siamese: "Psst!", persian: "Pardon me.", tabby: "Hey.", bengal: "Quick one!", ragdoll: "Just a gentle note.", shorthair: "A reminder." };
const voice = (p: Person, line: string) => `${OPENER[p.breed ?? "tabby"] ?? OPENER.tabby} ${line}`;
const kittenOf = (p: Person) => p.kitten ?? `${p.name}'s kitten`;
const quiet = (p: Person, now: Date) => inQuietHours(p.tz, p.quiet_start, p.quiet_end, now);

async function peopleById(d: Db, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map<string, Person>();
  const rows = await d.query<Person>(
    `select u.id, u.name, u.tz, u.quiet_start, u.quiet_end, k.name as kitten, k.breed from users u left join kittens k on k.user_id=u.id where u.id = any($1::uuid[])`,
    [unique],
  );
  return new Map(rows.map((p) => [p.id, p]));
}

async function sentSoFar(d: Db, kind: Kind) {
  const rows = await d.query<{ object_id: string; user_id: string; n: number; last: string }>(
    `select object_id, user_id, count(*)::int as n, max(sent_at) as last from reminders where kind=$1 group by object_id, user_id`,
    [kind],
  );
  const seen = new Map(rows.map((r) => [`${r.object_id}:${r.user_id}`, { count: r.n, lastMs: new Date(r.last).getTime() }]));
  return (objectId: string, userId: string) => seen.get(`${objectId}:${userId}`) ?? { count: 0, lastMs: null };
}

/** Record it and tell the person, in one step. False if this round was already sent (a timer running twice). */
async function send(d: Db, now: Date, r: Send) {
  return d.tx(async (q) => {
    const added = await q.query(
      `insert into reminders (kind, object_id, user_id, round, text, from_user, sent_at) values ($1,$2,$3,$4,$5,$6,$7) on conflict do nothing returning id`,
      [r.kind, r.objectId, r.userId, r.round, r.text, r.fromUser ?? null, now.toISOString()],
    );
    if (!added.length) return false;
    await logEvent(q, { userId: r.userId, squadId: r.squadId, actor: "kitten", type: r.type, objectType: r.objectType, objectId: r.objectId, payload: { ...r.payload, round: r.round, text: r.text }, reason: r.reason });
    return true;
  });
}

/** An Untangle payment still open: day 3 and day 7, then it stops. */
async function remindPayments(d: Db, now: Date) {
  const open = await d.query<{ id: string; squad_id: string; from_user: string; to_user: string; cents: number; created_at: string }>(
    `select id, squad_id, from_user, to_user, cents, created_at from yarn_settlements where status='open' and paid_via is distinct from 'paypal_pending'`,
  );
  const sent = await sentSoFar(d, "yarn_pay");
  const who = await peopleById(d, open.flatMap((s) => [s.from_user, s.to_user]));
  let count = 0;
  for (const s of open) {
    const round = nextRound(sent(s.id, s.from_user), now.getTime(), afterDays(s.created_at, PAY_DAYS));
    const payer = who.get(s.from_user);
    const owed = who.get(s.to_user);
    if (!round || !payer || !owed || quiet(payer, now)) continue;
    const ask = round === PAY_DAYS.length ? "asked me to remind you one last time" : "asked me to remind you";
    const sentNow = await send(d, now, {
      kind: "yarn_pay",
      objectId: s.id,
      objectType: "yarn_settlement",
      userId: s.from_user,
      fromUser: s.to_user,
      squadId: s.squad_id,
      round,
      type: "yarn.reminder",
      text: voice(payer, `${kittenOf(owed)} ${ask}: ${fmt(s.cents)} to ${owed.name} is still open.`),
      payload: { settlementId: s.id, cents: s.cents },
      reason: `unpaid for ${PAY_DAYS[round - 1]} days`,
    });
    if (!sentNow) continue;
    count++;
    await send(d, now, {
      kind: "owed_note",
      objectId: s.id,
      objectType: "yarn_settlement",
      userId: s.to_user,
      squadId: s.squad_id,
      round,
      type: "reminder.sent",
      text: `I nudged ${payer.name}'s kitten about the ${fmt(s.cents)}. You don't need to say a thing.`,
      reason: "a payment to you is still open",
    });
  }
  return count;
}

/** An "I paid" card someone hasn't answered: day 2 and day 5. Only the people who haven't answered hear about it. */
async function remindCards(d: Db, now: Date) {
  const open = await d.query<{ id: string; squad_id: string; note: string; created_by: string; created_at: string; user_id: string }>(
    `select c.id, c.squad_id, c.note, c.created_by, c.created_at, p.user_id from yarn_parts p join yarn_cards c on c.id=p.card_id where p.status='pending' and c.status='pending'`,
  );
  const sent = await sentSoFar(d, "card_confirm");
  const who = await peopleById(d, open.flatMap((c) => [c.user_id, c.created_by]));
  let count = 0;
  for (const c of open) {
    const round = nextRound(sent(c.id, c.user_id), now.getTime(), afterDays(c.created_at, CARD_DAYS));
    const person = who.get(c.user_id);
    const author = who.get(c.created_by);
    if (!round || !person || !author || quiet(person, now)) continue;
    const last = round === CARD_DAYS.length;
    const sentNow = await send(d, now, {
      kind: "card_confirm",
      objectId: c.id,
      objectType: "yarn",
      userId: c.user_id,
      fromUser: c.created_by,
      squadId: c.squad_id,
      round,
      type: "yarn.card_reminder",
      text: voice(person, `${kittenOf(author)} asked me ${last ? "one last time" : "to check"}: is the "${c.note}" card right?`),
      payload: { cardId: c.id },
      reason: `not answered for ${CARD_DAYS[round - 1]} days`,
    });
    if (!sentNow) continue;
    count++;
    await send(d, now, {
      kind: "owed_note",
      objectId: c.id,
      objectType: "yarn",
      userId: c.created_by,
      squadId: c.squad_id,
      round,
      type: "reminder.sent",
      // Never who: a card is between friends, and nobody gets singled out (no shame, §A9).
      text: last ? `I've asked twice about "${c.note}". If it's still open, you can fix or remove the card.` : `I nudged the kittens who haven't checked "${c.note}" yet. You don't need to say a thing.`,
      reason: "a card you logged is still waiting",
    });
  }
  return count;
}

/** A share that hasn't gone in yet because the Treat Jar is short: 48 and 12 hours before the deadline (FR-NEG-4). */
async function remindPlans(d: Db, now: Date) {
  const open = await d.query<{ id: string; title: string; squad_id: string; host_id: string; decide_by: string; created_at: string; user_id: string }>(
    `select p.id, p.title, p.squad_id, p.host_id, p.decide_by, p.created_at, m.user_id
     from plans p join plan_members m on m.plan_id=p.id
     join memberships ms on ms.squad_id=p.squad_id and ms.user_id=m.user_id and ms.left_at is null
     where p.status='open' and p.decide_by > $1 and m.status='in' and m.limit_cents is not null
       and coalesce((select sum(w.cents) from paws w where w.plan_id=p.id and w.user_id=m.user_id and w.status='held' and w.kind<>'cover'),0) < m.limit_cents`,
    [now.toISOString()],
  );
  const sent = await sentSoFar(d, "plan_paw");
  const who = await peopleById(d, open.flatMap((p) => [p.user_id, p.host_id]));
  let count = 0;
  for (const p of open) {
    if (now.getTime() - new Date(p.created_at).getTime() < PLAN_MIN_AGE_MS) continue;
    const round = nextRound(sent(p.id, p.user_id), now.getTime(), beforeDeadline(p.decide_by, PLAN_HOURS_LEFT));
    const person = who.get(p.user_id);
    const host = who.get(p.host_id);
    if (!round || !person || !host || quiet(person, now)) continue;
    const when = new Date(p.decide_by).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: validTz(person.tz) });
    const isHost = p.user_id === p.host_id;
    const line = isHost ? `"${p.title}" closes ${when}, and your share isn't in yet. Refill your Treat Jar so it can happen.` : `${kittenOf(host)} asked me to check on "${p.title}". It closes ${when}. Refill your Treat Jar so your share goes in.`;
    const sentNow = await send(d, now, {
      kind: "plan_paw",
      objectId: p.id,
      objectType: "plan",
      userId: p.user_id,
      fromUser: isHost ? undefined : p.host_id,
      squadId: p.squad_id,
      round,
      type: "plan.reminder",
      text: voice(person, line),
      payload: { planId: p.id },
      reason: `${PLAN_HOURS_LEFT[round - 1]} hours until the deadline`,
    });
    if (!sentNow) continue;
    count++;
    if (!isHost) {
      await send(d, now, {
        kind: "owed_note",
        objectId: p.id,
        objectType: "plan",
        userId: p.host_id,
        squadId: p.squad_id,
        round,
        type: "reminder.sent",
        text: `I nudged the friends whose share of "${p.title}" isn't in yet. You don't need to chase anyone.`,
        reason: "your plan's deadline is close",
      });
    }
  }
  return count;
}

/** A whim someone hasn't answered: 48 and 12 hours before its deadline. The host's name stays out of it (FR-WHIM-5). */
async function remindWhims(d: Db, now: Date) {
  const open = await d.query<{ id: string; what: string; squad_id: string; owner_id: string; decide_by: string; created_at: string; user_id: string }>(
    `select w.id, w.what, w.squad_id, w.owner_id, w.decide_by, w.created_at, a.user_id
     from answers a join whims w on w.id=a.whim_id
     join memberships ms on ms.squad_id=w.squad_id and ms.user_id=a.user_id and ms.left_at is null
     where w.status='floating' and a.confirmed is null and w.decide_by > $1
       and not exists (select 1 from whim_negotiations n where n.whim_id=w.id and n.user_id=a.user_id and n.status='with_host')`,
    [now.toISOString()],
  );
  const sent = await sentSoFar(d, "whim_answer");
  const who = await peopleById(d, open.map((w) => w.user_id));
  let count = 0;
  for (const w of open) {
    if (now.getTime() - new Date(w.created_at).getTime() < PLAN_MIN_AGE_MS) continue;
    const round = nextRound(sent(w.id, w.user_id), now.getTime(), beforeDeadline(w.decide_by, PLAN_HOURS_LEFT));
    const person = who.get(w.user_id);
    if (!round || !person || quiet(person, now)) continue;
    const when = new Date(w.decide_by).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: validTz(person.tz) });
    const sentNow = await send(d, now, { kind: "whim_answer", objectId: w.id, objectType: "whim", userId: w.user_id, squadId: w.squad_id, round, type: "whim.reminder", text: voice(person, `"${w.what}" closes ${when}, and it's waiting on your answer.`), payload: { whimId: w.id }, reason: `${PLAN_HOURS_LEFT[round - 1]} hours until the deadline` });
    if (!sentNow) continue;
    count++;
    await send(d, now, { kind: "owed_note", objectId: w.id, objectType: "whim", userId: w.owner_id, squadId: w.squad_id, round, type: "reminder.sent", text: `I nudged the friends who haven't answered "${w.what}" yet. You don't need to chase anyone.`, reason: "your whim's deadline is close" });
  }
  return count;
}

/** A paid-for booking with no confirmed receipt: 72 hours and 6 days after it was paid. The squad sees "receipt pending", with no name. */
async function remindReceipts(d: Db, now: Date) {
  const unpaid = await d.query<{ id: string; title: string; squad_id: string; booker_id: string; pounced_at: string }>(
    `select p.id, p.title, p.squad_id, p.booker_id,
       greatest(p.booked_elsewhere_at, (select max(l.created_at) from ledger l where l.plan_id=p.id and l.kind='booking_paid' and l.account='world' and l.amount_cents > 0)) as pounced_at
     from plans p join pounces x on x.plan_id=p.id and x.status='done'
     where p.status='pounced' and not exists (select 1 from receipts r where r.plan_id=p.id and r.status='confirmed')
       and (p.booked_elsewhere_at is not null or exists (select 1 from ledger l where l.plan_id=p.id and l.kind='booking_paid' and l.account='world' and l.amount_cents > 0))`,
  );
  // Until it's paid for in full, the booker's card is "Pay", not "Add the receipt", so there's nothing to chase yet.
  const { bookingState } = await import("./jar");
  const rows = [];
  for (const r of unpaid) if ((await bookingState(d, r.id))?.remainingCents === 0) rows.push(r);
  const sent = await sentSoFar(d, "receipt");
  const who = await peopleById(d, rows.map((p) => p.booker_id));
  let count = 0;
  for (const p of rows) {
    const round = nextRound(sent(p.id, p.booker_id), now.getTime(), afterHours(p.pounced_at, RECEIPT_HOURS));
    const booker = who.get(p.booker_id);
    if (!round || !booker || quiet(booker, now)) continue;
    const sentNow = await send(d, now, {
      kind: "receipt",
      objectId: p.id,
      objectType: "plan",
      userId: p.booker_id,
      squadId: p.squad_id,
      round,
      type: "receipt.reminder",
      text: voice(booker, round === RECEIPT_HOURS.length ? `One last nudge: "${p.title}" still needs its receipt.` : `"${p.title}" still needs its receipt. Add it so leftovers go back.`),
      payload: { planId: p.id },
      reason: "no receipt yet",
    });
    if (!sentNow) continue;
    count++;
    if (round === 1) await logEvent(d, { squadId: p.squad_id, actor: "system", type: "plan.receipt_pending", objectType: "plan", objectId: p.id, public: { text: `${p.title}: receipt pending.` } });
  }
  return count;
}

export async function remindersJob(now = new Date()) {
  const d = await db();
  return { payments: await remindPayments(d, now), cards: await remindCards(d, now), plans: await remindPlans(d, now), whims: await remindWhims(d, now), receipts: await remindReceipts(d, now) };
}

/**
 * "Remind Tyler about the $16" from the kitten chat (FR-CHAT-7). It uses up one of the same reminders the schedule
 * would send, so asking can't get round the limits, the gap between reminders, or quiet hours.
 */
export async function remindNow(userId: string, friendId: string, now = new Date(), opts: { squadId?: string } = {}): Promise<{ status: "sent" | "limit" | "soon" | "quiet" | "nothing"; text: string }> {
  const d = await db();
  const who = await peopleById(d, [userId, friendId]);
  const me = who.get(userId);
  const friend = who.get(friendId);
  if (!me || !friend) return { status: "nothing", text: "I can only remind friends in your squads." };
  const [pay] = await d.query<{ id: string; squad_id: string; cents: number }>(`select id, squad_id, cents from yarn_settlements where status='open' and paid_via is distinct from 'paypal_pending' and from_user=$1 and to_user=$2 and ($3::uuid is null or squad_id=$3) order by created_at limit 1`, [friendId, userId, opts.squadId ?? null]);
  // From My Month, one row can be several payments to the same person: the reminder is for all of it.
  if (pay && opts.squadId) pay.cents = (await d.query<{ c: number }>(`select sum(cents)::int as c from yarn_settlements where status='open' and from_user=$1 and to_user=$2 and squad_id=$3`, [friendId, userId, opts.squadId]))[0].c;
  const [card] = await d.query<{ id: string; squad_id: string; note: string }>(`select c.id, c.squad_id, c.note from yarn_parts p join yarn_cards c on c.id=p.card_id where p.user_id=$1 and p.status='pending' and c.status='pending' and c.created_by=$2 order by c.created_at limit 1`, [friendId, userId]);
  // A plan you're hosting that's still waiting on their share.
  const [plan] = await d.query<{ id: string; squad_id: string; title: string }>(
    `select p.id, p.squad_id, p.title from plans p join plan_members m on m.plan_id=p.id
     where p.status='open' and p.decide_by > $3 and p.host_id=$2 and m.user_id=$1 and m.status='in' and m.limit_cents is not null
       and coalesce((select sum(w.cents) from paws w where w.plan_id=p.id and w.user_id=m.user_id and w.status='held' and w.kind<>'cover'),0) < m.limit_cents
     order by p.decide_by limit 1`,
    [friendId, userId, now.toISOString()],
  );
  // A whim you floated that they haven't answered.
  const [whim] = await d.query<{ id: string; squad_id: string; what: string }>(
    `select w.id, w.squad_id, w.what from answers a join whims w on w.id=a.whim_id
     where a.user_id=$1 and a.confirmed is null and w.owner_id=$2 and w.status='floating'
       and not exists (select 1 from whim_negotiations n where n.whim_id=w.id and n.user_id=a.user_id and n.status='with_host')
     order by w.decide_by limit 1`,
    [friendId, userId],
  );
  const target = pay ?? card ?? plan ?? whim;
  if (!target) return { status: "nothing", text: `There's nothing open with ${friend.name} for me to remind them about.` };
  if (quiet(friend, now)) return { status: "quiet", text: `It's quiet hours for ${friend.name}. Ask me again in the morning.` };
  const kind: Kind = pay ? "yarn_pay" : card ? "card_confirm" : plan ? "plan_paw" : "whim_answer";
  const limit = pay ? PAY_DAYS.length : card ? CARD_DAYS.length : PLAN_HOURS_LEFT.length;
  const sent = (await sentSoFar(d, kind))(target.id, friendId);
  if (sent.count >= limit) return { status: "limit", text: `I've already reminded ${friend.name} as much as I'm allowed. I don't want to nag.` };
  if (sent.lastMs != null && now.getTime() - sent.lastMs < MIN_GAP_MS) return { status: "soon", text: `I reminded ${friend.name} not long ago. Let's give it a little time.` };
  const round = sent.count + 1;
  const from = kittenOf(me);
  const line = pay ? `${from} asked me to remind you: ${fmt(pay.cents)} to ${me.name} is still open.` : card ? `${from} asked me to check: is the "${card.note}" card right?` : plan ? `${from} asked me to check on "${plan.title}". Refill your Treat Jar so your share goes in.` : `"${whim.what}" is waiting for your answer.`;
  await send(d, now, {
    kind,
    objectId: target.id,
    objectType: pay ? "yarn_settlement" : card ? "yarn" : plan ? "plan" : "whim",
    userId: friendId,
    fromUser: !pay && !card && !plan ? undefined : userId, // a whim's floater stays anonymous (FR-WHIM-5)
    squadId: target.squad_id,
    round,
    type: pay ? "yarn.reminder" : card ? "yarn.card_reminder" : plan ? "plan.reminder" : "whim.reminder",
    text: voice(friend, line),
    payload: pay ? { settlementId: pay.id, cents: pay.cents } : card ? { cardId: card.id } : plan ? { planId: plan.id } : { whimId: whim.id },
    reason: `${me.name} asked me to`,
  });
  return { status: "sent", text: `Done. I nudged ${friend.name}'s kitten. You don't need to say a thing.` };
}
