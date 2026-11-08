import { db } from "../db";
import { getKitten, getUser, listRules } from "./users";
import { pendingAnswers } from "./whims";
import { myMonth } from "./mymonth";
import { myGiftInvites } from "./catnip";
import { monthSpending } from "./month";
import { funBudgetCents } from "../referee/rules";
import { localToday, validTz } from "../referee/time";

/**
 * Meows: the daily brief, and urgent alerts (PRD §B16, FR-MEOW-1..3, FR-MONTH-3). Built from the event log and
 * Kitty's own data, in the kitten's voice (breed tone, templates: instant and free). Every "Needs you" item carries
 * the one call that acts on it (FR-MEOW-2).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
type Action = { method: "POST" | "GET"; path: string; body?: Record<string, unknown> };
type Item = { text: string; action?: Action };

const HELLO: Record<string, (k: string) => string> = {
  siamese: (k) => `Hi hi! ${k} here with your Meows.`,
  persian: (k) => `Good morning. ${k} has your Meows ready.`,
  tabby: (k) => `Hey. ${k} here, Meows below.`,
  bengal: (k) => `Rise and shine! ${k} has today's Meows!`,
  ragdoll: (k) => `Morning, friend. ${k} gathered your Meows.`,
  shorthair: (k) => `${k}: today's Meows.`,
};
const SMALL_THINGS = ["Cats sleep about 15 hours a day. Your kitten is clearly an overachiever.", "A group of kittens is called a kindle.", "Cats can't taste sweetness. Your kitten still likes a good plan."];

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
     and type not like 'catnip.%' and payload ? 'text' order by id desc limit 6`,
    [userId, now.toISOString()],
  );

  // Needs you: one tap each.
  const needs: Item[] = [];
  for (const a of await pendingAnswers(userId)) needs.push({ text: `Confirm your answer for "${a.what}" (I suggest ${a.prepared}).`, action: { method: "POST", path: "answers/confirm", body: { items: [{ answerId: a.id }] } } });
  const pawups = await d.query<{ plan_id: string; title: string; pawup_need_cents: number }>(`select m.plan_id, p.title, m.pawup_need_cents from plan_members m join plans p on p.id=m.plan_id where m.user_id=$1 and m.pawup_need_cents > 0 and p.status='open'`, [userId]);
  for (const p of pawups) needs.push({ text: `"${p.title}" needs ${fmt(p.pawup_need_cents)} more from you. Paw up?`, action: { method: "POST", path: `plans/${p.plan_id}/paw-up`, body: { accept: true } } });
  const receipts = await d.query<{ id: string; title: string }>(
    `select p.id, p.title from plans p join pounces x on x.plan_id=p.id and x.status='done' where p.booker_id=$1 and p.status='pounced' and not exists (select 1 from receipts r where r.plan_id=p.id)`,
    [userId],
  );
  for (const p of receipts) needs.push({ text: `Add the receipt for "${p.title}" so leftovers go back.`, action: { method: "POST", path: `plans/${p.id}/receipt` } });
  const cards = await d.query<{ id: string; note: string }>(`select c.id, c.note from yarn_parts p join yarn_cards c on c.id=p.card_id where p.user_id=$1 and p.status='pending' and c.status='pending'`, [userId]);
  for (const c of cards) needs.push({ text: `Is the "${c.note}" card right?`, action: { method: "POST", path: `yarn/cards/${c.id}/confirm` } });
  const pay = await d.query<{ id: string; cents: number; name: string }>(`select s.id, s.cents, u.name from yarn_settlements s join users u on u.id=s.to_user where s.from_user=$1 and s.status='open'`, [userId]);
  for (const s of pay) needs.push({ text: `Pay ${fmt(s.cents)} to ${s.name} to untangle.`, action: { method: "POST", path: `yarn/settlements/${s.id}/pay` } });
  const asks = await d.query<{ request_id: string; name: string; suggested_cents: number }>(
    `select a.request_id, u.name, a.suggested_cents from help_asks a join help_requests r on r.id=a.request_id join users u on u.id=r.requester_id where a.user_id=$1 and a.status='asked' and r.status='open'`,
    [userId],
  );
  for (const a of asks) needs.push({ text: `${a.name} could use a hand. Pledge ${fmt(a.suggested_cents)}?`, action: { method: "POST", path: `help/${a.request_id}/pledge`, body: { cents: a.suggested_cents } } });
  for (const g of (await myGiftInvites(userId)).filter((x) => x.status === "invited")) needs.push({ text: `${g.for_name}'s birthday is coming. Join the group gift?`, action: { method: "POST", path: `gifts/${g.group_id}/join` } });
  const bowls = await d.query<{ bowl_id: string; service: string; share_cents: number }>(`select m.bowl_id, b.service, m.share_cents from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='pending'`, [userId]);
  for (const b of bowls) needs.push({ text: `Join ${b.service} in the Bowl (${fmt(b.share_cents)} a month)?`, action: { method: "POST", path: `bowls/${b.bowl_id}/join` } });

  // Coming up: the next 7 days.
  const month = await myMonth(userId, now);
  const week = now.getTime() + 7 * 86400_000;
  const coming: Item[] = [
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

function inQuietHours(tz: string, start: string, end: string, now: Date) {
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: validTz(tz), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return start > end ? hm >= start || hm < end : hm >= start && hm < end;
}

/** Urgent alerts only (FR-MEOW-3): a Pounce, a paw-up, a help request for you, a failed capture, a decide-by within 2 h. */
export async function alerts(userId: string, now = new Date()) {
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  const [q] = await d.query<{ quiet_start: string; quiet_end: string }>(`select quiet_start, quiet_end from users where id=$1`, [userId]);
  const items: Item[] = [];
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
