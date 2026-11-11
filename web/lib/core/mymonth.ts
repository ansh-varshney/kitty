import { db, type Queryable } from "../db";
import { acct } from "./ledger";
import { calendar, committedCents, jarBalances, monthRange, monthSpending, REFUND_KINDS, SPEND_KINDS } from "./month";
import { listRules } from "./users";
import { myYarn } from "./yarn";
import { settlePeople, settleUp } from "./settle-up";
import { memberBalances } from "./party";
import { funBudgetCents } from "../referee/rules";

type Spent = { key: string; kind: "plan" | "held" | "card" | "help" | "bowl" | "payment" | "booking"; title: string; sub: string; cents: number; at: string; href: string; upcoming?: boolean };

/** Every payment behind this month's spending, with where to go to see it (FR-MONTH-6). */
async function spentItems(q: Queryable, userId: string, now: Date): Promise<Spent[]> {
  const { start, end } = monthRange(now);
  const inMonth = [userId, start, end];
  const plans = await q.query<{ id: string; title: string; squad: string; at: string; c: number }>(
    `select p.id, p.title, s.name as squad, max(l.created_at) as at,
       sum(case when l.kind = any($4) and l.amount_cents > 0 then l.amount_cents when l.kind = any($5) and l.amount_cents < 0 then l.amount_cents else 0 end)::int as c
     from ledger l join plans p on l.account = 'plan:' || p.id join squads s on s.id = p.squad_id
     where l.user_id=$1 and l.created_at >= $2 and l.created_at < $3 group by p.id, p.title, s.name`,
    [...inMonth, SPEND_KINDS, REFUND_KINDS],
  );
  const held = await q.query<{ id: string; title: string; squad: string; at: string; c: number }>(
    `select pl.id, pl.title, s.name as squad, max(p.created_at) as at, sum(p.cents)::int as c from paws p join plans pl on pl.id=p.plan_id join squads s on s.id=pl.squad_id
     where p.user_id=$1 and p.status in ('pending','held') and pl.status in ('open','pouncing') group by pl.id, pl.title, s.name`,
    [userId],
  );
  const whimHeld = await q.query<{ id: string; what: string; squad: string; at: string; c: number }>(
    `select w.id, w.what, s.name as squad, h.created_at as at, (h.jar_cents + h.savings_cents)::int as c from whim_holds h join whims w on w.id=h.whim_id join squads s on s.id=w.squad_id where h.user_id=$1 and h.status='held'`,
    [userId],
  );
  const tagHeld = await q.query<{ id: string; title: string; squad: string; at: string; c: number }>(
    `select p.id, p.title, s.name as squad, r.created_at as at, (r.held_jar + r.held_savings)::int as c from tag_requests r join plans p on p.id=r.plan_id join squads s on s.id=p.squad_id where r.user_id=$1 and r.status='asked' and r.held_jar + r.held_savings > 0`,
    [userId],
  );
  const cards = await q.query<{ id: string; note: string; squad_id: string; squad: string; kind: string; squad_kind: string; at: string; c: number; payer: string; mine: boolean; other: string | null }>(
    `select c.id, c.note, c.squad_id, s.name as squad, c.kind, s.kind as squad_kind, c.created_at as at, p.cents as c, pu.name as payer, false as mine, c.payer_id as other
       from yarn_cards c join yarn_parts p on p.card_id=c.id join squads s on s.id=c.squad_id join users pu on pu.id=c.payer_id
      where p.user_id=$1 and p.cents > 0 and c.status='confirmed' and c.kind <> 'loan' and c.created_at >= $2 and c.created_at < $3
     union all
     select c.id, c.note, c.squad_id, s.name as squad, c.kind, s.kind as squad_kind, c.created_at as at,
            case when c.kind='treat' then c.cents else c.cents - coalesce((select sum(cents) from yarn_parts where card_id=c.id),0) end as c, '' as payer, true as mine,
            (select user_id from yarn_parts where card_id=c.id limit 1) as other
       from yarn_cards c join squads s on s.id=c.squad_id
      where c.payer_id=$1 and c.status='confirmed' and c.kind <> 'loan' and c.created_at >= $2 and c.created_at < $3`,
    inMonth,
  );
  const help = await q.query<{ id: string; name: string; note: string; at: string; c: number }>(
    `select r.id, u.name, r.note, l.created_at as at, l.amount_cents as c from ledger l join help_requests r on l.account = 'help:' || r.id join users u on u.id=r.requester_id
     where l.user_id=$1 and l.kind='help_give' and l.amount_cents > 0 and l.created_at >= $2 and l.created_at < $3`,
    inMonth,
  );
  const bowlPaid = await q.query<{ ledger_id: string; id: string; service: string; squad_id: string; squad: string; at: string; c: number }>(
    `select l.id as ledger_id, b.id, b.service, b.squad_id, s.name as squad, l.created_at as at, l.amount_cents as c from ledger l join bowls b on l.account = 'bowl:' || b.id join squads s on s.id=b.squad_id
     where l.user_id=$1 and l.kind='bowl_share' and l.amount_cents > 0 and l.created_at >= $2 and l.created_at < $3`,
    inMonth,
  );
  const bowlDue = await q.query<{ id: string; service: string; squad_id: string; squad: string; at: string; c: number }>(
    `select b.id, b.service, b.squad_id, s.name as squad, m.next_pay_at as at, m.share_cents as c from bowl_members m join bowls b on b.id=m.bowl_id join squads s on s.id=b.squad_id
     where m.user_id=$1 and m.status='active' and b.status='active' and m.next_pay_at is not null`,
    [userId],
  );
  const payments = await q.query<{ id: string; name: string; squad_id: string; squad: string; squad_kind: string; other: string; at: string; c: number; note: string | null }>(
    `select x.id, u.name, x.squad_id, s.name as squad, s.kind as squad_kind, x.to_user as other, x.paid_at as at, x.cents as c, x.note from yarn_settlements x join users u on u.id=x.to_user join squads s on s.id=x.squad_id
     where x.from_user=$1 and x.status='paid' and x.paid_at >= $2 and x.paid_at < $3`,
    inMonth,
  );
  const bookings = await q.query<{ event_id: string; id: string; title: string; at: string; c: number }>(
    `select e.id as event_id, p.id, p.title, e.created_at as at, (e.payload->>'cents')::int as c from events e join plans p on p.id=e.object_id
     where e.user_id=$1 and e.type='booking.paid' and e.created_at >= $2 and e.created_at < $3`,
    inMonth,
  );
  const yarnHref = (squadKind: string, squadId: string, other: string | null) => (squadKind === "direct" && other ? `/chat/${other}` : `/squads/${squadId}?tab=yarn`);
  const bowlHref = (squadId: string, id: string) => `/squads/${squadId}?tab=bowl&open=${id}`;
  const items: Spent[] = [
    ...plans.filter((p) => p.c).map((p): Spent => ({ key: `plan:${p.id}`, kind: "plan", title: p.title, sub: `Your share, ${p.squad}`, cents: p.c, at: p.at, href: `/plans/${p.id}` })),
    ...held.map((p): Spent => ({ key: `held:${p.id}`, kind: "held", title: p.title, sub: `Set aside, not final yet, ${p.squad}`, cents: p.c, at: p.at, href: `/plans/${p.id}` })),
    ...whimHeld.map((w): Spent => ({ key: `whimheld:${w.id}`, kind: "held", title: w.what, sub: `Set aside, still being decided, ${w.squad}`, cents: w.c, at: w.at, href: `/whims/${w.id}` })),
    ...tagHeld.map((t): Spent => ({ key: `tagheld:${t.id}`, kind: "held", title: t.title, sub: `Set aside to tag along, ${t.squad}`, cents: t.c, at: t.at, href: `/plans/${t.id}` })),
    ...cards.filter((c) => c.c > 0).map((c): Spent => ({ key: `card:${c.id}:${c.mine}`, kind: "card", title: c.note, sub: c.mine ? (c.kind === "treat" ? `Your treat, ${c.squad}` : `Your part, you paid, ${c.squad}`) : `Your part, ${c.payer} paid, ${c.squad}`, cents: c.c, at: c.at, href: yarnHref(c.squad_kind, c.squad_id, c.other) })),
    ...help.map((h): Spent => ({ key: `help:${h.id}:${h.at}`, kind: "help", title: `Helped ${h.name}`, sub: h.note, cents: h.c, at: h.at, href: "/kitten/lives" })),
    ...bowlPaid.map((b): Spent => ({ key: `bowl:${b.ledger_id}`, kind: "bowl", title: b.service, sub: `Your share, ${b.squad}`, cents: b.c, at: b.at, href: bowlHref(b.squad_id, b.id) })),
    ...payments.map((x): Spent => ({ key: `pay:${x.id}`, kind: "payment", title: `Paid ${x.name}`, sub: x.note ? `For ${x.note}` : `Settle up, ${x.squad}`, cents: x.c, at: x.at, href: yarnHref(x.squad_kind, x.squad_id, x.other) })),
    ...bookings.map((b): Spent => ({ key: `book:${b.event_id}`, kind: "booking", title: `Booked ${b.title}`, sub: "From everyone's money", cents: b.c, at: b.at, href: `/plans/${b.id}` })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Every Bowl you're in is always here with its next date, like a Kitty Party in Saved. It isn't spent until it's paid.
  return [...items, ...bowlDue.map((b): Spent => ({ key: `bowldue:${b.id}`, kind: "bowl", title: b.service, sub: b.squad, cents: b.c, at: b.at, href: bowlHref(b.squad_id, b.id), upcoming: true }))];
}

/** How full the Treat Jar has been this month, so the slider has something to measure against. */
async function jarFull(q: Queryable, userId: string, start: string, availableCents: number) {
  const [r] = await q.query<{ peak: number | null }>(`select max(running)::int as peak from (select created_at, sum(amount_cents) over (order by id) as running from ledger where account=$1) t where created_at >= $2`, [acct.jar(userId), start]);
  return Math.max(r.peak ?? 0, availableCents);
}

/**
 * My Month (PRD §B20, FR-MONTH-1/4, FR-CAL-1): the owner's private view of their month with friends, from Kitty's
 * own ledger. Money: budget meter, by squad, by kind, owed, saved, coming up. Calendar: plans in, decide-bys, busy.
 */
export async function myMonth(userId: string, now = new Date()) {
  const d = await db();
  const spending = await monthSpending(d, userId, now);
  const committed = await committedCents(d, userId);
  const budget = funBudgetCents(await listRules(d, userId));
  const yarn = await myYarn(userId);
  const squads = await d.query<{ id: string; name: string }>(`select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 and m.left_at is null and s.kind='squad'`, [userId]);
  const saved = [];
  for (const s of squads) {
    const mine = (await memberBalances(d, s.id))[userId] ?? 0;
    if (mine) saved.push({ squadId: s.id, squad: s.name, cents: mine });
  }
  const jar = await jarBalances(d, userId);
  const cal = await calendar(d, userId);
  const in30 = now.getTime() + 30 * 86400_000;
  const holds = await d.query<{ title: string; cents: number; decide_by: string }>(
    `select pl.title, sum(p.cents)::int as cents, pl.decide_by from paws p join plans pl on pl.id=p.plan_id
     where p.user_id=$1 and p.status in ('pending','held') and pl.status in ('open','pouncing') group by pl.id, pl.title, pl.decide_by order by pl.decide_by`,
    [userId],
  );
  // Kitty Party savings are logged here but aren't spending: the money is still yours (FR-PARTY-7).
  const { start, end } = monthRange(now);
  const thisMonth = await d.query<{ name: string; cents: number }>(
    `select p.name, sum(l.amount_cents)::int as cents from ledger l join parties p on l.account = 'savings:' || p.squad_id || ':' || $1::text
     where l.user_id=$1::uuid and l.kind='savings_contribution' and l.amount_cents > 0 and l.created_at >= $2 and l.created_at < $3 group by p.name order by p.name`,
    [userId, start, end],
  );
  const savingSoon = await d.query<{ title: string; cents: number; decide_by: string }>(
    `select 'Into ' || p.name as title, m.monthly_cents as cents, m.next_save_at as decide_by from party_members m join parties p on p.id=m.party_id where m.user_id=$1 and m.status='active' and m.next_save_at is not null order by m.next_save_at`,
    [userId],
  );
  const bowlSoon = await d.query<{ title: string; cents: number; decide_by: string }>(
    `select b.service as title, m.share_cents as cents, m.next_pay_at as decide_by from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='active' and b.status='active' and m.next_pay_at is not null order by m.next_pay_at`,
    [userId],
  );
  const parties = await d.query<{ name: string; squad_id: string; squad: string; status: string; monthly_cents: number; next_save_at: string | null }>(
    `select p.name, p.squad_id, s.name as squad, m.status, m.monthly_cents, m.next_save_at from party_members m join parties p on p.id=m.party_id join squads s on s.id=p.squad_id where m.user_id=$1 order by p.name`,
    [userId],
  );
  const kitties = [];
  for (const k of parties) {
    const balanceCents = (await memberBalances(d, k.squad_id))[userId] ?? 0;
    if (k.status !== "active" && !balanceCents) continue;
    kitties.push({ squadId: k.squad_id, name: k.name, squad: k.squad, balanceCents, active: k.status === "active", monthlyCents: k.monthly_cents, nextAt: k.next_save_at, thisMonthCents: thisMonth.find((t) => t.name === k.name)?.cents ?? 0 });
  }
  return {
    money: {
      jar: { ...jar, fullCents: await jarFull(d, userId, start, jar.availableCents) },
      people: await settlePeople(userId),
      spent: await spentItems(d, userId, now),
      kitties,
      meter: { spentCents: spending.totalCents, committedCents: committed, budgetCents: budget, leftCents: budget != null ? budget - spending.totalCents - committed : null },
      bySquad: spending.bySquad,
      byKind: spending.byKind,
      owed: { youOweCents: yarn.reduce((a, y) => a + y.youOweCents, 0), owedToYouCents: yarn.reduce((a, y) => a + y.owedToYouCents, 0) },
      settleUp: await settleUp(userId), // everything left to settle, across every group (FR-MONTH-5)
      saved: { partySavings: saved, treatJar: jar, thisMonth },
      comingUp: [...holds, ...savingSoon, ...bowlSoon].filter((h) => Date.parse(h.decide_by) <= in30).sort((a, b) => Date.parse(a.decide_by) - Date.parse(b.decide_by)),
    },
    calendar: {
      plans: cal.plans.filter((p) => p.starts_at).map((p) => ({ id: p.id, title: p.title, startsAt: p.starts_at, endsAt: p.ends_at, decideBy: p.decide_by, status: p.status })),
      decideBy: cal.plans.filter((p) => p.status === "open").map((p) => ({ id: p.id, title: p.title, decideBy: p.decide_by })),
      busy: cal.busy,
    },
  };
}
