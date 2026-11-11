import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { monthSpending } from "./month";
import { funBudgetCents } from "../referee/rules";
import { listRules } from "./users";

/**
 * Purrs, collar tags, Top Cat and streaks (PRD §B17, FR-PURR-1..3). A job reads the event log since its last run
 * and awards purrs and tags. Nothing here ever shows or ranks money, debts or declines (FR-PURR-3).
 */

export const TAGS: Record<string, string> = {
  "First Paw": "First to paw in on a plan",
  Clutch: "Being the booker",
  "Zero Nudges": "5 times paying or pawing in without a reminder",
  Untangler: "5 times settling Yarn the same day",
  Lifesaver: "Helping with a Nine Lives request",
  "Catnip Captain": "Booking a group gift",
  Saver: "3 months in a row of Kitty Party saving",
  "On Budget": "A month within your fun budget (private)",
};

type Ev = { id: string; type: string; user_id: string | null; squad_id: string | null; object_id: string | null; created_at: string };

async function award(q: Queryable, e: Ev, userId: string, points: number, reason: string) {
  await q.query(`insert into purrs (user_id, squad_id, points, reason, event_id) values ($1,$2,$3,$4,$5) on conflict do nothing`, [userId, e.squad_id, points, reason, Number(e.id)]);
}

async function tag(q: Queryable, userId: string, name: string, priv = false) {
  const r = await q.query(`insert into collar_tags (user_id, tag, private) values ($1,$2,$3) on conflict do nothing returning 1`, [userId, name, priv]);
  if (r.length) await logEvent(q, { userId, actor: "kitten", type: "purr.tag", payload: { tag: name, text: `New collar tag: ${name}. ${TAGS[name]}.` } });
}

async function count(q: Queryable, sql: string, params: unknown[]) {
  const [r] = await q.query<{ n: number }>(sql, params);
  return r.n;
}

async function bookedForTheSquad(q: Queryable, e: Ev, userId: string) {
  await award(q, e, userId, 5, "booked for the squad");
  await tag(q, userId, "Clutch");
  const gift = await count(q, `select count(*)::int as n from squads where id=$1 and kind='gift'`, [e.squad_id]);
  if (gift) await tag(q, userId, "Catnip Captain");
}

/** Job: award purrs and tags from new events (FR-PURR-1). */
export async function purrsScan() {
  const d = await db();
  const [st] = await d.query<{ cursor: string }>(`insert into job_state (name) values ('purrs') on conflict (name) do update set name=excluded.name returning cursor`);
  const events = await d.query<Ev>(
    `select id, type, user_id, squad_id, object_id, created_at from events where id > $1 and user_id is not null
     and type in ('paw.placed','paw.cover','pounce.charged','pounce.paid_booker','yarn.settled','help.given','party.saved') order by id limit 2000`,
    [Number(st.cursor)],
  );
  let awarded = 0;
  for (const e of events) {
    const u = e.user_id!;
    await d.tx(async (q) => {
      switch (e.type) {
        case "paw.placed": {
          await award(q, e, u, 2, "pawed in");
          const earlier = await count(q, `select count(*)::int as n from events where type='paw.placed' and object_id=$1 and id < $2`, [e.object_id, Number(e.id)]);
          if (earlier === 0) {
            await award(q, e, u, 3, "first paw");
            await tag(q, u, "First Paw");
          }
          const quick = await count(q, `select count(*)::int as n from events p where p.user_id=$1 and p.type in ('paw.placed','yarn.settled') and not exists (select 1 from events r where r.user_id=$1 and r.type in ('yarn.reminder','plan.reminder') and r.object_id=p.object_id)`, [u]);
          if (quick >= 5) await tag(q, u, "Zero Nudges");
          break;
        }
        case "paw.cover":
          await award(q, e, u, 3, "covered a friend");
          await tag(q, u, "Clutch");
          break;
        // Since v1.33 the pot goes to the booker's Treat Jar at the Pounce: that's the moment they take on the booking.
        case "pounce.charged": {
          const booking = await count(q, `select count(*)::int as n from plans where id=$1 and booker_id=$2`, [e.object_id, u]);
          if (booking) await bookedForTheSquad(q, e, u);
          break;
        }
        case "pounce.paid_booker":
          await bookedForTheSquad(q, e, u);
          break;
        case "yarn.settled": {
          await award(q, e, u, 2, "untangled");
          const sameDay = await count(q, `select count(*)::int as n from yarn_settlements where from_user=$1 and status='paid' and paid_at::date = created_at::date`, [u]);
          if (sameDay >= 5) await tag(q, u, "Untangler");
          break;
        }
        case "help.given":
          await award(q, e, u, 5, "helped a friend");
          await tag(q, u, "Lifesaver");
          break;
        case "party.saved": {
          await award(q, e, u, 1, "saved with the squad");
          const months = await count(q, `select count(distinct to_char(created_at,'YYYY-MM'))::int as n from events where user_id=$1 and type='party.saved' and created_at > now() - interval '92 days'`, [u]);
          if (months >= 3) await tag(q, u, "Saver");
          break;
        }
      }
      awarded++;
    });
  }
  if (events.length) await d.query(`update job_state set cursor=$1, ran_at=now() where name='purrs'`, [Number(events[events.length - 1].id)]);
  return { events: awarded };
}

/** Job: at the start of a month, a private "On Budget" tag for everyone who stayed within last month's fun budget. */
export async function onBudgetMonthEnd(now = new Date()) {
  const d = await db();
  const month = now.toISOString().slice(0, 7);
  const [st] = await d.query<{ cursor: string }>(`insert into job_state (name) values ('on_budget') on conflict (name) do update set name=excluded.name returning cursor`);
  const key = Number(month.replace("-", ""));
  if (Number(st.cursor) >= key) return { checked: 0 };
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  const users = await d.query<{ id: string }>(`select id from users where onboarded`);
  let tagged = 0;
  for (const u of users) {
    const budget = funBudgetCents(await listRules(d, u.id));
    if (budget == null) continue;
    const spent = (await monthSpending(d, u.id, lastMonth)).totalCents;
    if (spent > 0 && spent <= budget) {
      await tag(d, u.id, "On Budget", true);
      tagged++;
    }
  }
  await d.query(`update job_state set cursor=$1, ran_at=now() where name='on_budget'`, [key]);
  return { checked: users.length, tagged };
}

/** My purrs and tags (private tags included, only for me). */
export async function myPurrs(userId: string) {
  const d = await db();
  const [t] = await d.query<{ p: string | null }>(`select coalesce(sum(points),0) as p from purrs where user_id=$1`, [userId]);
  const tags = await d.query<{ tag: string; private: boolean; earned_at: string }>(`select tag, private, earned_at from collar_tags where user_id=$1 order by earned_at`, [userId]);
  return { purrs: Number(t.p ?? 0), tags: tags.map((x) => ({ ...x, about: TAGS[x.tag] })) };
}

/** A squad's weekly Top Cat and streak (FR-PURR-2). Names and purrs only, never money. */
export async function squadPurrs(squadId: string, now = new Date()) {
  const d = await db();
  const top = await d.query<{ name: string; p: string }>(
    `select u.name, sum(p.points) as p from purrs p join users u on u.id=p.user_id where p.squad_id=$1 and p.created_at > $2::timestamptz - interval '7 days'
     group by u.name order by sum(p.points) desc, u.name limit 1`,
    [squadId, now.toISOString()],
  );
  const plans = await d.query<{ status: string; decide_by: string }>(
    `select p.status, p.decide_by from plans p where p.squad_id=$1 and p.status in ('pounced','settled') order by p.decide_by desc limit 50`,
    [squadId],
  );
  let streak = 0;
  for (const p of plans) {
    const fresh = Date.parse(p.decide_by) > now.getTime() - 7 * 86400_000;
    if (p.status === "settled" || fresh) streak++;
    else break;
  }
  const publicTags = await d.query<{ name: string; tag: string }>(
    `select u.name, t.tag from collar_tags t join users u on u.id=t.user_id join memberships m on m.user_id=t.user_id and m.squad_id=$1 and m.left_at is null where not t.private order by t.earned_at desc limit 20`,
    [squadId],
  );
  return { topCat: top[0] ? { name: top[0].name, purrs: Number(top[0].p) } : null, streak, tags: publicTags };
}
