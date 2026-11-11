import { db, type Queryable } from "../db";
import { getKitten, getUser, listRules } from "./users";
import { pendingAnswers } from "./whims";
import { cardTurns, turnItem } from "./yarn";
import { CARD_EVENTS } from "./describe";
import { myMonth } from "./mymonth";
import { myGiftInvites } from "./catnip";
import { jarBalances, monthSpending } from "./month";
import { funBudgetCents } from "../referee/rules";
import { localToday, validTz } from "../referee/time";
import { inQuietHours } from "../referee/reminders";
import { MAX_WHIM_CHANGES } from "../referee/negotiate";

/**
 * Meows: the daily brief, and urgent alerts (PRD §B16, FR-MEOW-1..3, FR-MONTH-3). Built from the event log and
 * Kitty's own data, in the kitten's voice (breed tone, templates: instant and free). Every "Needs you" item carries
 * the one call that acts on it (FR-MEOW-2).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
type Db = Queryable;
type Plain = Omit<Item, "key">;
const POST = "POST" as const;
const GET = "GET" as const;
/** Closes a card until something about it changes (the key changes with it). */
const notNow = (key: string, label = "Not now") => ({ label, action: { method: POST, path: "kitten/cards/dismiss", body: { key } } });
type Action = { method: "POST" | "GET"; path: string; body?: Record<string, unknown> };
export type Item = {
  /** What this card is about. The same key is one card, in the kitten's chat and in Meows. */
  key: string;
  text: string;
  /** The main tap. */
  action?: Action;
  /** When a card has more than one answer (FR-REMIND-6). */
  choices?: { label: string; action: Action }[];
  /** A typed reply: send the text as `field` along with this action's body. */
  reply?: Action & { field: string };
  /** A PayPal approval still to finish. */
  approveUrl?: string;
  /** The friend's kitten this came from, so the card can show it (FR-REMIND-3). */
  from?: { name: string; look: unknown };
  /** A one-to-one whim or plan: it also shows in the chat with this friend. */
  withFriend?: string;
  /** The whim behind this, to read the kittens' conversation. */
  whim?: { id: string };
  /** The "I paid" card behind this, to open and read. */
  card?: { id: string };
  replyLabel?: string;
  replyHint?: string;
};

const HELLO: Record<string, (k: string) => string> = {
  siamese: (k) => `Hi hi! ${k} here with your Meows.`,
  persian: (k) => `Good morning. ${k} has your Meows ready.`,
  tabby: (k) => `Hey. ${k} here, Meows below.`,
  bengal: (k) => `Rise and shine! ${k} has today's Meows!`,
  ragdoll: (k) => `Morning, friend. ${k} gathered your Meows.`,
  shorthair: (k) => `${k}: today's Meows.`,
};
const SMALL_THINGS = ["Cats sleep about 15 hours a day. Your kitten is clearly an overachiever.", "A group of kittens is called a kindle.", "Cats can't taste sweetness. Your kitten still likes a good plan."];

/** A friend's whim: yes, no, or send your kitten to negotiate (FR-WHIM-10). */
export function answerCard(a: Awaited<ReturnType<typeof pendingAnswers>>[number], kittenName: string, tz: string): Item {
  const say = (answer: string): Action => ({ method: POST, path: "answers/confirm", body: { items: [{ answerId: a.id, answer }] } });
  const when = a.starts_at ? new Date(a.starts_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : a.when_text;
  const canNegotiate = !a.negotiated && a.version < MAX_WHIM_CHANGES;
  const yes = { label: "Yes", action: say("yes") };
  const no = { label: "No", action: say("no") };
  const talk = { label: `Ask ${kittenName} to negotiate`, action: { method: POST, path: `whims/${a.whim_id}/negotiate` } as Action };
  const advice = a.prepared === "negotiate" ? (canNegotiate ? "I'd try to negotiate." : "It doesn't quite fit, so it's your call.") : `I'd say ${a.prepared}.`;
  return {
    ...(a.squad_kind === "direct" ? { withFriend: a.owner_id } : {}),
    key: `answer:${a.id}:${a.version}`,
    text: `${a.squad_kind === "direct" ? `${a.owner_name} wants to do this with you. ` : ""}${a.version ? "Changed: " : ""}"${a.what}"${when ? `, ${when}` : ""}${a.place ? ` at ${a.place}` : ""}. ${advice} ${a.shareText}.`,
    action: yes.action,
    choices: a.prepared === "negotiate" && canNegotiate ? [talk, yes, no] : canNegotiate ? [yes, no, talk] : [yes, no],
    whim: { id: a.whim_id },
  };
}

/** A friend's kitten is asking to change your whim: only you can say yes (FR-NEG-11). */
export async function negotiationCards(d: Queryable, userId: string, tz: string): Promise<Item[]> {
  const rows = await d.query<{ id: string; whim_id: string; what: string; who: string; price_mode: string | null; proposal: { startsAt?: string; priceCents?: number } }>(
    `select n.id, n.whim_id, w.what, w.price_mode, u.name as who, n.proposal from whim_negotiations n join whims w on w.id=n.whim_id join users u on u.id=n.user_id where w.owner_id=$1 and n.status='with_host' and w.status='floating' order by n.created_at`,
    [userId],
  );
  return rows.map((n) => {
    const change = [n.proposal.startsAt ? new Date(n.proposal.startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz }) : null, n.proposal.priceCents != null ? `${fmt(n.proposal.priceCents)} ${n.price_mode === "per_person" ? "each" : "in total"}` : null].filter(Boolean).join(", ");
    const yes: Action = { method: POST, path: `negotiations/${n.id}/accept` };
    return { key: `negotiate:${n.id}`, text: `${n.who}'s kitten asked me about "${n.what}". They'd like ${change}. OK with you?`, action: yes, choices: [{ label: "Accept", action: yes }, { label: "Keep it as it is", action: { method: POST, path: `negotiations/${n.id}/keep` } }], whim: { id: n.whim_id } };
  });
}

/** What needs this person right now, worked out from the app's own state. */
async function needsFor(d: Db, userId: string, now: Date): Promise<Item[]> {
  // A card that has been chased reads in the reminding kitten's voice (FR-REMIND-3).
  const reminded = await d.query<{ kind: string; object_id: string; text: string; name: string | null; look: unknown }>(
    `select distinct on (r.kind, r.object_id) r.kind, r.object_id, r.text, k.name, k.look from reminders r left join kittens k on k.user_id=r.from_user
     where r.user_id=$1 and r.kind <> 'owed_note' order by r.kind, r.object_id, r.round desc`,
    [userId],
  );
  const said = new Map(reminded.map((r) => [`${r.kind}:${r.object_id}`, r]));
  const chased = (kind: string, id: string, item: Item): Item => {
    const r = said.get(`${kind}:${id}`);
    return r?.text ? { ...item, text: r.text, ...(r.name ? { from: { name: r.name, look: r.look } } : {}) } : item;
  };

  // Needs you: one tap each.
  const [{ tz }] = await d.query<{ tz: string }>(`select tz from users where id=$1`, [userId]);
  const needs: Item[] = [];
  const myKitten = (await getKitten(d, userId))?.name ?? "my kitten";
  for (const a of await pendingAnswers(userId)) needs.push(answerCard(a, myKitten, tz));
  needs.push(...(await negotiationCards(d, userId, tz)));
  const receipts = await d.query<{ id: string; title: string; receipt_id: string | null; read_cents: number | null }>(
    `select distinct p.id, p.title,
       (select r.id from receipts r where r.plan_id=p.id and r.status='pending' and r.extracted_cents is not null order by r.created_at desc limit 1) as receipt_id,
       (select r.extracted_cents from receipts r where r.plan_id=p.id and r.status='pending' and r.extracted_cents is not null order by r.created_at desc limit 1) as read_cents
     from plans p join pounces x on x.plan_id=p.id and x.status='done' where p.booker_id=$1 and p.status='pounced' and not exists (select 1 from receipts r where r.plan_id=p.id and r.status='confirmed')`,
    [userId],
  );
  const { bookingState } = await import("./jar");
  for (const p of receipts) {
    const add = { method: POST, path: `plans/${p.id}/receipt` };
    const booking = p.receipt_id ? null : await bookingState(d, p.id);
    if (booking && booking.remainingCents > 0) {
      // Not paid for yet: that comes first. Paid some other way? Then straight to the receipt.
      const pay: Action = { method: POST, path: `plans/${p.id}/pay-booking` };
      const elsewhere: Action = { method: POST, path: `plans/${p.id}/paid-elsewhere` };
      needs.push({ key: `bookpay:${p.id}:${booking.remainingCents}`, text: booking.paidCents ? `You've paid ${fmt(booking.paidCents)} for "${p.title}". ${fmt(booking.remainingCents)} is left to pay.` : `Everyone's money for "${p.title}" is in your Treat Jar. Pay for the booking from it?`, action: pay, choices: [{ label: "Pay from my Treat Jar", action: pay }, { label: "I paid another way", action: elsewhere }] });
      continue;
    }
    if (p.receipt_id && p.read_cents != null) {
      const yes = { method: POST, path: `receipts/${p.receipt_id}/confirm`, body: { cents: p.read_cents } };
      needs.push({ key: `receiptcheck:${p.receipt_id}`, text: `I read ${fmt(p.read_cents)} on the "${p.title}" receipt. Is that right?`, action: yes, choices: [{ label: "Yes, that's right", action: yes }, { label: "Not right", action: add }] });
    } else needs.push(chased("receipt", p.id, { key: `receipt:${p.id}`, text: `Add the receipt for "${p.title}" so leftovers go back.`, action: add }));
  }
  for (const t of await cardTurns(d, userId)) {
    const item = turnItem(t, userId) as Item;
    needs.push({ ...chased("card_confirm", t.card_id, item), text: item.text });
  }
  const pay = await d.query<{ id: string; cents: number; name: string; note: string | null }>(`select s.id, s.cents, u.name, s.note from yarn_settlements s join users u on u.id=s.to_user where s.from_user=$1 and s.status='open'`, [userId]);
  for (const s of pay) needs.push(chased("yarn_pay", s.id, { key: `pay:${s.id}`, text: `Pay ${fmt(s.cents)} to ${s.name}${s.note ? ` for ${s.note}` : " to untangle"}.`, action: { method: "POST", path: `yarn/settlements/${s.id}/pay` } }));
  // Your share of a plan that hasn't gone in yet, because the Treat Jar is short (FR-JAR-7, FR-PLAN-10).
  const owing = await d.query<{ id: string; title: string; decide_by: string; limit_cents: number; held: number }>(
    `select p.id, p.title, p.decide_by, m.limit_cents, coalesce((select sum(w.cents)::int from paws w where w.plan_id=p.id and w.user_id=$1 and w.status='held' and w.kind<>'cover'),0) as held
     from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 where p.status='open' and m.status='in' and m.limit_cents is not null and p.decide_by > $2 order by p.decide_by`,
    [userId, now.toISOString()],
  );
  if (owing.some((o) => o.held < o.limit_cents)) {
    const { availableCents } = await jarBalances(d, userId);
    for (const o of owing.filter((x) => x.held < x.limit_cents)) {
      const short = o.limit_cents - o.held - availableCents;
      const by = new Date(o.decide_by).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
      const pay: Action = { method: POST, path: `plans/${o.id}/chip-in`, body: { refill: true } };
      needs.push(chased("plan_paw", o.id, { key: `chip:${o.id}:${o.limit_cents}`, text: short > 0 ? `"${o.title}": your share is ${fmt(o.limit_cents)}, and your Treat Jar is ${fmt(short)} short. Refill by ${by} and I'll put it in.` : `"${o.title}": your share is ${fmt(o.limit_cents)}. Your Treat Jar has enough now.`, action: pay, choices: [{ label: short > 0 ? `Refill ${fmt(short)}` : "Put it in", action: pay }] }));
    }
  }
  // A plan you never answered: until the Pounce you can just join.
  const couldJoin = await d.query<{ id: string; title: string; price_cents: number; price_mode: string; need_at_least: number; in_count: number }>(
    `select p.id, p.title, p.price_cents, p.price_mode, p.need_at_least, (select count(*)::int from plan_members x where x.plan_id=p.id and x.status='in') as in_count
     from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 where p.status='open' and m.status='invited' and p.decide_by > $2`,
    [userId, now.toISOString()],
  );
  for (const p of couldJoin) {
    const key = `join:${p.id}`;
    const each = p.price_mode === "per_person" ? p.price_cents : Math.ceil(p.price_cents / Math.max(p.need_at_least, p.in_count + 1));
    const join: Action = { method: POST, path: `plans/${p.id}/tag-along` };
    needs.push({ key, text: `"${p.title}" is happening. You can still join for about ${fmt(each)}.`, action: join, choices: [{ label: "Join", action: join }, notNow(key)] });
  }
  // A plan you never answered that has already Pounced: you can still ask the host to tag along (FR-POUNCE-14).
  const couldTag = await d.query<{ id: string; title: string; host: string }>(
    `select p.id, p.title, u.name as host from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 join users u on u.id=p.host_id
     where p.status in ('pounced','settled') and m.status='invited' and (p.starts_at is null or p.starts_at > $2)
       and not exists (select 1 from tag_requests r where r.plan_id=p.id and r.user_id=$1)`,
    [userId, now.toISOString()],
  );
  if (couldTag.length) {
    const { tagQuote } = await import("./pounce");
    for (const p of couldTag) {
      const quote = await tagQuote(d, p.id, userId).catch(() => null);
      const key = `tag:${p.id}`;
      const ask: Action = { method: POST, path: `plans/${p.id}/tag-along` };
      needs.push({ key, text: `"${p.title}" is final. Want to tag along? I'll ask ${p.host}.${quote ? ` Your share would be about ${fmt(quote.cents)}.` : ""}`, action: ask, choices: [{ label: "Tag along", action: ask }, notNow(key)] });
    }
  }
  // After the Pounce: someone's asking the host if they can tag along (FR-POUNCE-14).
  const tagAsks = await d.query<{ id: string; title: string; who: string }>(
    `select r.id, p.title, u.name as who from tag_requests r join plans p on p.id=r.plan_id join users u on u.id=r.user_id
     where p.host_id=$1 and r.status='asked' and p.status in ('pounced','settled') and (p.starts_at is null or p.starts_at > $2) order by r.created_at`,
    [userId, now.toISOString()],
  );
  for (const r of tagAsks) {
    const yes: Action = { method: POST, path: `tag-requests/${r.id}/accept` };
    needs.push({ key: `tagask:${r.id}`, text: `${r.who} is asking to tag along on "${r.title}". OK?`, action: yes, choices: [{ label: "Yes", action: yes }, { label: "No", action: { method: POST, path: `tag-requests/${r.id}/decline` } }] });
  }
  // The host said yes and the jar was short: only the money is left.
  const tagDue = await d.query<{ id: string; plan_id: string; title: string; host: string }>(
    `select r.id, r.plan_id, p.title, u.name as host from tag_requests r join plans p on p.id=r.plan_id join users u on u.id=p.host_id
     where r.user_id=$1 and r.status='approved' and p.status in ('pounced','settled') and (p.starts_at is null or p.starts_at > $2)`,
    [userId, now.toISOString()],
  );
  if (tagDue.length) {
    const { tagQuote } = await import("./pounce");
    const { availableCents } = await jarBalances(d, userId);
    for (const r of tagDue) {
      const q = await tagQuote(d, r.plan_id, userId);
      const short = q.jarCents - availableCents;
      const pay: Action = { method: POST, path: `tag-requests/${r.id}/pay`, body: { refill: true } };
      needs.push({ key: `tagpay:${r.id}:${q.cents}`, text: short > 0 ? `${r.host} said yes to you tagging along on "${r.title}". Your share is ${fmt(q.cents)}, and your Treat Jar is ${fmt(short)} short. Refill and you're in.` : `${r.host} said yes to you tagging along on "${r.title}". Your share is ${fmt(q.cents)}.`, action: pay, choices: [{ label: short > 0 ? `Refill ${fmt(short)}` : "Put it in", action: pay }] });
    }
  }
  // Decisions that are the host's.
  const hosting = await d.query<{ id: string; title: string; status: string; in_count: number; need_at_least: number; all_paid: boolean }>(
    `select p.id, p.title, p.status, p.need_at_least, (select count(*)::int from plan_members x where x.plan_id=p.id and x.status='in') as in_count,
       not exists (select 1 from plan_members x where x.plan_id=p.id and x.status='in' and coalesce((select sum(w.cents) from paws w where w.plan_id=p.id and w.user_id=x.user_id and w.status='held' and w.kind<>'cover'),0) < coalesce(x.limit_cents,1)) as all_paid
     from plans p where p.host_id=$1 and p.status in ('open','on_ice')`,
    [userId],
  );
  for (const p of hosting) {
    const open: Action = { method: GET, path: `plans/${p.id}` };
    if (p.status === "on_ice") {
      const key = `ice:${p.id}`;
      needs.push({ key, text: `"${p.title}" is on ice. Not enough money came in by the deadline. Give it more time, or cancel?`, action: open, choices: [{ label: "Give it more time", action: open }, { label: "Cancel it", action: { method: POST, path: `plans/${p.id}/cancel` } }, notNow(key)] });
    } else if (p.all_paid && p.in_count >= p.need_at_least) {
      const key = `pounce:${p.id}:${p.in_count}`;
      const go = { method: POST, path: `plans/${p.id}/pounce` };
      needs.push({ key, text: `Everyone's money is in for "${p.title}". Pounce?`, action: go, choices: [{ label: "Pounce", action: go }, notNow(key, "Not yet")] });
    }
  }
  const extras = await d.query<{ id: string; title: string; cents: number }>(
    `select p.id, p.title, m.overrun_due_cents as cents from plan_members m join plans p on p.id=m.plan_id where m.user_id=$1 and m.overrun_due_cents > 0 and not m.overrun_paid and p.status='pounced'`,
    [userId],
  );
  for (const x of extras) {
    const key = `overrun:${x.id}:${x.cents}`;
    const pay = { method: POST, path: `plans/${x.id}/overrun/pay` };
    needs.push({ key, text: `"${x.title}" came to a bit more. Your part is ${fmt(x.cents)}.`, action: pay, choices: [{ label: `Pay ${fmt(x.cents)}`, action: pay }, notNow(key)] });
  }
  // A hold that still needs its PayPal approval (FR-POUNCE-10): your spot isn't safe until it's done.
  const holds = await d.query<{ id: string; title: string; approve_url: string; source: string }>(
    `select distinct on (p.id) p.id, p.title, w.approve_url, w.source from paws w join plans p on p.id=w.plan_id
     where w.user_id=$1 and w.status='pending' and w.approve_url is not null and p.status='open' order by p.id, w.created_at desc`,
    [userId],
  );
  for (const h of holds) needs.push({ key: `hold:${h.id}`, text: h.source === "jar" ? `"${h.title}": refill your Treat Jar so your spot is safe.` : `"${h.title}": approve your hold so your spot is safe.`, action: { method: "GET", path: `plans/${h.id}` }, approveUrl: h.approve_url });
  // A friend's kitten asked something only you can answer (FR-REMIND-6).
  const questions = await d.query<{ id: string; payload: { text: string } }>(
    `select e.id, e.payload from events e where e.user_id=$1 and e.type='kitten.ask_owner' and e.created_at > $2::timestamptz - interval '72 hours'
       and not exists (select 1 from events a where a.user_id=$1 and a.type='kitten.owner_answered' and a.payload->>'askEventId' = e.id::text) order by e.id`,
    [userId, now.toISOString()],
  );
  for (const q of questions) {
    const eventId = Number(q.id);
    const answer = (a: string): Action => ({ method: "POST", path: "kitten/answer", body: { eventId, answer: a } });
    needs.push({ key: `ask:${eventId}`, text: q.payload.text, choices: [{ label: "Yes", action: answer("Yes") }, { label: "No", action: answer("No") }], reply: { method: "POST", path: "kitten/answer", body: { eventId }, field: "answer" } });
  }
  // A Kitty Party saving the Treat Jar couldn't cover: gentle, private, no penalty (§B13, FR-PARTY-8).
  const failedSavings = await d.query<{ name: string; squad_id: string; monthly_cents: number; asked_on: string }>(
    `select p.name, p.squad_id, m.monthly_cents, to_char(m.payment_failed_at, 'YYYY-MM-DD') as asked_on from party_members m join parties p on p.id=m.party_id where m.user_id=$1 and m.status='active' and m.payment_failed_at is not null`,
    [userId],
  );
  if (failedSavings.length) {
    const { availableCents } = await jarBalances(d, userId);
    for (const f of failedSavings) {
      const short = f.monthly_cents - availableCents;
      if (short <= 0) continue; // the next run of the timer moves it
      const key = `partyfail:${f.squad_id}:${f.asked_on}`;
      const topUp: Action = { method: POST, path: "jar/topup", body: { cents: short } };
      needs.push({ key, text: `Your Treat Jar is ${fmt(short)} short for your ${fmt(f.monthly_cents)} into ${f.name}. Top it up and I'll put it in?`, action: topUp, choices: [{ label: `Top up ${fmt(short)}`, action: topUp }, notNow(key)] });
    }
  }
  const asks = await d.query<{ request_id: string; name: string; suggested_cents: number; note: string }>(
    `select a.request_id, u.name, a.suggested_cents, r.note from help_asks a join help_requests r on r.id=a.request_id join users u on u.id=r.requester_id where a.user_id=$1 and a.status='asked' and r.status='open'`,
    [userId],
  );
  for (const a of asks) {
    const yes = { method: POST, path: `help/${a.request_id}/pledge`, body: { cents: a.suggested_cents } };
    needs.push({ key: `help:${a.request_id}`, text: `${a.name} could use a hand: ${a.note}. Pledge ${fmt(a.suggested_cents)}?`, action: yes, choices: [{ label: `Pledge ${fmt(a.suggested_cents)}`, action: yes }, { label: "Choose an amount", action: { method: GET, path: `help/${a.request_id}` } }, { label: "Not this time", action: { method: POST, path: `help/${a.request_id}/decline` } }] });
  }
  // Friends pledged to what you asked for: take it, or wait for more.
  const pledged = await d.query<{ id: string; cents: number; note: string; pledged: number; helpers: number }>(
    `select r.id, r.cents, r.note, sum(p.cents)::int as pledged, count(distinct p.user_id)::int as helpers from help_requests r join help_pledges p on p.request_id=r.id and p.status='held' where r.requester_id=$1 and r.status='open' group by r.id, r.cents, r.note`,
    [userId],
  );
  for (const r of pledged) {
    const key = `helpaccept:${r.id}:${r.pledged}`;
    const yes = { method: POST, path: `help/${r.id}/accept` };
    needs.push({ key, text: `${r.helpers} ${r.helpers === 1 ? "friend" : "friends"} pledged ${fmt(r.pledged)} of the ${fmt(r.cents)} you asked for: ${r.note}. Take it now?`, action: yes, choices: [{ label: `Accept ${fmt(r.pledged)}`, action: yes }, notNow(key, "Keep waiting"), { label: "Close and return it", action: { method: POST, path: `help/${r.id}/close` } }] });
  }
  for (const g of (await myGiftInvites(userId)).filter((x) => x.status === "invited")) {
    const yes = { method: POST, path: `gifts/${g.group_id}/join` };
    needs.push({ key: `gift:${g.group_id}`, text: `${g.for_name}'s birthday is coming. Join the group gift?`, action: yes, choices: [{ label: "Join", action: yes }, { label: "Skip this one", action: { method: POST, path: `gifts/${g.group_id}/skip` } }] });
  }
  const bowls = await d.query<{ bowl_id: string; squad_id: string; service: string; share_cents: number; holder: boolean }>(`select m.bowl_id, b.squad_id, b.service, m.share_cents, b.owner_id=$1 as holder from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='pending' and b.status='active'`, [userId]);
  for (const b of bowls) {
    const open: Action = { method: GET, path: `squads/${b.squad_id}/bowls/${b.bowl_id}/join` };
    if (b.holder) needs.push({ key: `bowl:${b.bowl_id}:${b.share_cents}`, text: `Pick the day for your ${fmt(b.share_cents)} share of ${b.service}?`, action: open, choices: [{ label: "Pick a day", action: open }] });
    else needs.push({ key: `bowl:${b.bowl_id}:${b.share_cents}`, text: `Join ${b.service} in the Bowl (${fmt(b.share_cents)} a month)?`, action: open, choices: [{ label: "Join", action: open }, { label: "Not for me", action: { method: POST, path: `bowls/${b.bowl_id}/leave` } }] });
  }
  // A Bowl share the Treat Jar couldn't cover: the same gentle ask as a Kitty Party saving.
  const failedShares = await d.query<{ bowl_id: string; service: string; share_cents: number; asked_on: string }>(
    `select m.bowl_id, b.service, m.share_cents, to_char(m.payment_failed_at, 'YYYY-MM-DD') as asked_on from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='active' and b.status='active' and m.payment_failed_at is not null`,
    [userId],
  );
  if (failedShares.length) {
    const { availableCents } = await jarBalances(d, userId);
    for (const f of failedShares) {
      const short = f.share_cents - availableCents;
      if (short <= 0) continue; // the next run of the timer moves it
      const key = `bowlfail:${f.bowl_id}:${f.asked_on}`;
      const topUp: Action = { method: POST, path: "jar/topup", body: { cents: short } };
      needs.push({ key, text: `Your Treat Jar is ${fmt(short)} short for your ${fmt(f.share_cents)} ${f.service} share. Top it up and I'll put it in?`, action: topUp, choices: [{ label: `Top up ${fmt(short)}`, action: topUp }, notNow(key)] });
    }
  }
  // A Kitty Party started in one of your squads.
  const parties = await d.query<{ id: string; name: string; squad_id: string; squad: string; who: string; goal_cents: number | null }>(
    `select p.id, p.name, p.squad_id, s.name as squad, u.name as who, p.goal_cents from parties p join squads s on s.id=p.squad_id join memberships ms on ms.squad_id=p.squad_id and ms.user_id=$1 and ms.left_at is null join users u on u.id=p.created_by
     where p.created_by <> $1 and not exists (select 1 from party_members x where x.party_id=p.id and x.user_id=$1)`,
    [userId],
  );
  for (const p of parties) {
    const key = `party:${p.id}`;
    const open: Action = { method: GET, path: `squads/${p.squad_id}/party/join` };
    needs.push({ key, text: `${p.who} started a Kitty Party in ${p.squad}: ${p.name}${p.goal_cents ? `, saving for ${fmt(p.goal_cents)}` : ""}. Want to save with them?`, action: open, choices: [{ label: "Start saving", action: open }, notNow(key)] });
  }
  // Gift ideas are in and you haven't picked one.
  const ideas = await d.query<{ id: string; for_name: string }>(
    `select g.id, u.name as for_name from gift_groups g join gift_members m on m.group_id=g.id and m.user_id=$1 and m.status='joined' join users u on u.id=g.birthday_user
     where g.status <> 'deleted' and g.plan_id is null and exists (select 1 from gift_ideas i where i.group_id=g.id) and not exists (select 1 from gift_ideas i where i.group_id=g.id and $1::text = any(i.votes::text[]))`,
    [userId],
  );
  for (const g of ideas) {
    const key = `giftvote:${g.id}`;
    const open: Action = { method: GET, path: `gifts/${g.id}` };
    needs.push({ key, text: `Gift ideas are in for ${g.for_name}. Pick your favourite?`, action: open, choices: [{ label: "See the ideas", action: open }, notNow(key)] });
  }
  return needs;
}

/**
 * The kitten is the manager (owner, 9 Nov): whatever needs you is filed as a card in its chat first, and Meows shows
 * those same cards. A card closes everywhere the moment it's dealt with, wherever that happened.
 */
export async function openNeeds(userId: string, now = new Date()): Promise<Item[]> {
  const d = await db();
  const needs = await needsFor(d, userId, now);
  for (const n of needs) {
    const { key, text, ...card } = n;
    await d.query(
      `insert into kitten_cards (user_id, key, text, card) values ($1,$2,$3,$4) on conflict (user_id, key) do update set text=excluded.text, card=excluded.card, done_at=case when kitten_cards.dismissed_at is null then null else kitten_cards.done_at end`,
      [userId, key, text, JSON.stringify(card)],
    );
  }
  await d.query(`update kitten_cards set done_at=now(), read_at=coalesce(read_at, now()) where user_id=$1 and done_at is null and not (key = any($2::text[]))`, [userId, needs.map((n) => n.key)]);
  const open = await d.query<{ key: string; text: string; card: Omit<Item, "key" | "text"> }>(`select key, text, card from kitten_cards where user_id=$1 and done_at is null order by id`, [userId]);
  return open.map((r) => ({ ...r.card, key: r.key, text: r.text }));
}

export async function buildMeows(userId: string, now = new Date()) {
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  const kitten = await getKitten(d, userId);
  const tz = validTz(user.tz);
  const today = localToday(tz, now);

  // What I did (last 24 h): the kitten's and system's notes to me.
  const did = await d.query<{ type: string; payload: { text?: string } }>(
    `select type, payload from events where user_id=$1 and actor in ('kitten','system') and created_at > $2::timestamptz - interval '24 hours'
     and type not like 'catnip.%' and type not in ('yarn.reminder','yarn.card_reminder','plan.reminder','receipt.reminder','party.payment_failed') and type <> all($3::text[])
     and payload ? 'text' order by id desc limit 6`,
    [userId, now.toISOString(), CARD_EVENTS],
  );

  const needs = await openNeeds(userId, now);

  // Coming up: the next 7 days.
  const month = await myMonth(userId, now);
  const week = now.getTime() + 7 * 86400_000;
  const coming: Plain[] = [
    ...month.calendar.plans.filter((p) => p.startsAt && Date.parse(p.startsAt) > now.getTime() && Date.parse(p.startsAt) < week).map((p) => ({ text: `${p.title} on ${new Date(p.startsAt!).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz })}.` })),
    ...month.calendar.decideBy.filter((p) => Date.parse(p.decideBy) < now.getTime() + 2 * 86400_000).map((p) => ({ text: `Decide on "${p.title}" by ${new Date(p.decideBy).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz })}.` })),
  ];

  // Your month (+ the recap on the 1st, FR-MONTH-3).
  const m = month.money.meter;
  const yourMonth = m.budgetCents != null ? `You've used ${fmt(m.spentCents)} of your ${fmt(m.budgetCents)} fun budget${m.committedCents ? `, with ${fmt(m.committedCents)} on hold` : ""}.` : `You've spent ${fmt(m.spentCents)} with friends this month.`;
  let recap: string | null = null;
  if (today.date.endsWith("-01")) {
    const last = await monthSpending(d, userId, new Date(now.getTime() - 5 * 86400_000));
    const budget = funBudgetCents(await listRules(d, userId));
    const savedNow = month.money.saved.partySavings.reduce((a, s) => a + s.cents, 0);
    recap = `Last month you spent ${fmt(last.totalCents)}${budget != null ? ` of ${fmt(budget)}` : ""} on friends${savedNow ? ` and have ${fmt(savedNow)} saved in Kitty Parties` : ""}.`;
  }

  const [newTag] = await d.query<{ payload: { text?: string } }>(`select payload from events where user_id=$1 and type='purr.tag' and created_at > $2::timestamptz - interval '24 hours' order by id desc limit 1`, [userId, now.toISOString()]);
  const kname = kitten?.name ?? "Your kitten";
  return {
    date: today.date,
    hello: (HELLO[kitten?.breed ?? "tabby"] ?? HELLO.tabby)(kname),
    sections: {
      whatIDid: did.map((e) => ({ text: e.payload.text! })),
      needsYou: needs,
      comingUp: coming,
      yourMonth: [{ text: yourMonth }, ...(recap ? [{ text: recap }] : [])],
      littleSomething: [{ text: newTag?.payload.text ?? SMALL_THINGS[Number(today.date.slice(8)) % SMALL_THINGS.length] }],
    },
  };
}

/** Urgent alerts only (FR-MEOW-3): a Pounce, a paw-up, a help request for you, a failed capture, a decide-by within 2 h. */
export async function alerts(userId: string, now = new Date()) {
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  const [q] = await d.query<{ quiet_start: string; quiet_end: string }>(`select quiet_start, quiet_end from users where id=$1`, [userId]);
  const items: Plain[] = [];
  const recent = await d.query<{ type: string; payload: { text?: string } }>(
    // A help ask stays an alert only while it can still be answered (not after you pledged, or it was filled or closed).
    `select e.type, e.payload from events e where e.user_id=$1 and e.type in ('pounce.charged','pounce.capture_failed','payout.delayed','help.asked') and e.created_at > $2::timestamptz - interval '6 hours'
       and (e.type <> 'help.asked' or exists (select 1 from help_asks a join help_requests r on r.id=a.request_id where a.request_id::text = e.payload->>'requestId' and a.user_id=$1 and a.status='asked' and r.status='open'))
     order by e.id desc limit 10`,
    [userId, now.toISOString()],
  );
  for (const e of recent) items.push({ text: e.payload.text ?? e.type });
  const pawups = await d.query<{ plan_id: string; title: string; pawup_need_cents: number }>(`select m.plan_id, p.title, m.pawup_need_cents from plan_members m join plans p on p.id=m.plan_id where m.user_id=$1 and m.pawup_need_cents > 0 and p.status='open'`, [userId]);
  for (const p of pawups) items.push({ text: `Paw-up needed: "${p.title}" is ${fmt(p.pawup_need_cents)} short on your side.`, action: { method: "POST", path: `plans/${p.plan_id}/paw-up`, body: { accept: true } } });
  const soon = await d.query<{ id: string; title: string; decide_by: string }>(
    `select p.id, p.title, p.decide_by from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 where p.status='open' and m.status in ('in','thinking','invited') and p.decide_by between $2::timestamptz and $2::timestamptz + interval '2 hours'`,
    [userId, now.toISOString()],
  );
  for (const p of soon) items.push({ text: `"${p.title}" decides within 2 hours.`, action: { method: "GET", path: `plans/${p.id}` } });
  const quiet = inQuietHours(user.tz, q.quiet_start, q.quiet_end, now);
  // Quiet hours: nothing pops up; Meows catches it in the morning (FR-MEOW-3).
  return quiet ? { quiet: true, waiting: items.length, items: [] } : { quiet: false, waiting: 0, items };
}
