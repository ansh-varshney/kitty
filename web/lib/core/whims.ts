import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { createSquad, getKitten, isMember, listRules, sharesASquad, squadMembers } from "./users";
import { calendar, committedCents, monthSpentCents, windowOf } from "./month";
import { clash } from "../referee/time";
import { funBudgetCents, usuallyIn } from "../referee/rules";
import { parseWhim, reasonLines } from "../kitten/ai";

/** Whims and prepared answers (PRD §B6, FR-WHIM-1..8, FR-KIT-3/4). */

const INTEREST_WORDS: Record<string, RegExp> = {
  travel: /trip|cabin|beach|getaway|vacation|travel|lake|road ?trip|villa/i,
  concerts: /concert|gig|tickets|festival|show|music/i,
  food: /dinner|brunch|lunch|food|ramen|pizza|tacos|restaurant|cafe|eat/i,
  games: /bowling|game night|arcade|board ?games|games/i,
  movies: /movie|cinema|film/i,
  sports: /game|match|pickleball|basketball|soccer|football|tennis|gym/i,
  outdoors: /hike|camping|outdoor|park|kayak|climb/i,
  nightlife: /bar|club|party|karaoke|drinks/i,
  shopping: /shopping|mall|market/i,
  wellness: /spa|yoga|wellness|sauna/i,
};

export type Facts = { answer: "yes" | "maybe" | "no"; facts: string[]; hardClash: boolean; overBudget: boolean };

/** The facts behind a prepared answer, computed in code (availability, budget, interest). */
export async function prepareFacts(
  q: Queryable,
  userId: string,
  opts: { squadId: string; squadName: string; what: string; startsAt: string | null; endsAt: string | null; perPersonCents: number | null; excludePlanId?: string },
): Promise<Facts> {
  const [user] = await q.query<{ interests: string[] }>(`select interests from users where id=$1`, [userId]);
  const rules = await listRules(q, userId);
  const cal = await calendar(q, userId, opts.excludePlanId);
  const facts: string[] = [];
  const w = windowOf(opts.startsAt, opts.endsAt);
  const c = clash(w, cal.plansIn, cal.busy);
  let hardClash = false;
  if (c.hard) {
    hardClash = true;
    const title = cal.plansIn.find((p) => p.planId === c.hard!.planId)?.title ?? "another plan";
    facts.push(`you're already in ${title} then`);
  } else if (c.soft) {
    facts.push(`you marked ${c.soft.label ?? "that time"} as busy`);
  } else if (w) {
    facts.push("you're free then");
  }
  let overBudget = false;
  const budget = funBudgetCents(rules);
  if (budget != null && opts.perPersonCents != null) {
    const headroom = budget - (await monthSpentCents(q, userId)) - (await committedCents(q, userId));
    if (opts.perPersonCents > headroom) {
      overBudget = true;
      facts.push("it would take you over your fun budget");
    } else facts.push("it fits your fun budget");
  }
  const liked = Object.entries(INTEREST_WORDS).find(([k, re]) => (user?.interests ?? []).includes(k) && re.test(opts.what));
  const usual = usuallyIn(rules, opts.squadId, opts.perPersonCents);
  if (liked) facts.push(`you love ${liked[0]}`);
  if (usual) facts.push(`you're usually in for ${opts.squadName} plans`);
  const answer: Facts["answer"] = hardClash ? "no" : overBudget || c.soft ? "maybe" : liked || usual ? "yes" : "maybe";
  // A "maybe" must say why: when nothing is wrong, it's that the kitten can't tell if it's their thing.
  if (answer === "maybe" && !overBudget && !c.soft && w) facts.push("I can't tell if it's your kind of thing");
  if (facts.length === 0) facts.push("no date or price yet");
  return { answer, facts, hardClash, overBudget };
}

export type WhimInput = {
  squadId?: string;
  friendIds?: string[];
  text?: string;
  imageBase64?: string;
  mimeType?: string;
  url?: string;
  what?: string;
  whenText?: string;
  startsAt?: string;
  endsAt?: string;
  upToCents?: number;
  priceCents?: number;
  needAtLeast?: number;
};

/** Create and float a whim: parse it, prepare every friend's answer, keep the floater anonymous (FR-WHIM-3/4/5). */
export async function createWhim(ownerId: string, input: WhimInput) {
  const d = await db();
  let squadId = input.squadId ?? null;
  if (!squadId && input.friendIds?.length) {
    for (const f of input.friendIds) if (!(await sharesASquad(d, ownerId, f))) throw new Error("You can only invite friends you share a squad with.");
  } else if (!squadId) throw new Error("Pick a squad or some friends.");
  if (squadId && !(await isMember(d, squadId, ownerId))) throw new Error("You're not in that squad.");

  const [owner] = await d.query<{ tz: string }>(`select tz from users where id=$1`, [ownerId]);
  const parsed = input.text || input.imageBase64 || input.url ? await parseWhim({ ...input, tz: owner?.tz }) : null;
  const what = input.what ?? parsed?.what ?? "Something fun";
  if (!squadId) {
    const mini = await createSquad(d, ownerId, what, { kind: "mini", memberIds: input.friendIds });
    squadId = mini.id;
  }
  const [squad] = await d.query<{ name: string; kind: string }>(`select name, kind from squads where id=$1`, [squadId]);
  const members = await squadMembers(d, squadId);
  const invitees = members.filter((m) => m.id !== ownerId);
  const need = Math.max(2, input.needAtLeast ?? Math.ceil(members.length / 2));
  if (need > members.length) throw new Error(`Only ${members.length} people are in this group, so "need at least" can be ${members.length} at most.`);
  const startsAt = input.startsAt ?? parsed?.startsAt ?? null;
  const endsAt = input.endsAt ?? parsed?.endsAt ?? null;
  const upTo = input.upToCents ?? parsed?.upToCents ?? null;
  const price = input.priceCents ?? parsed?.priceCents ?? null;
  const perPerson = price != null ? Math.ceil(price / Math.max(need, 1)) : upTo;

  const [whim] = await d.query<{ id: string }>(
    `insert into whims (owner_id, squad_id, what, when_text, starts_at, ends_at, up_to_cents, place, price_cents, image_url, source_url, need_at_least, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now() + interval '72 hours') returning id`,
    [ownerId, squadId, what, input.whenText ?? parsed?.whenText ?? null, startsAt, endsAt, upTo, parsed?.place ?? null, price, parsed?.imageUrl ?? null, parsed?.sourceUrl ?? null, need],
  );

  const facts = await Promise.all(
    invitees.map(async (m) => {
      const f = await prepareFacts(d, m.id, { squadId: squadId!, squadName: squad.name, what, startsAt, endsAt, perPersonCents: perPerson });
      const kitten = await getKitten(d, m.id);
      return { userId: m.id, breed: kitten?.breed ?? "tabby", ...f };
    }),
  );
  const lines = await reasonLines(facts.map((f) => ({ id: f.userId, breed: f.breed, answer: f.answer, facts: f.facts })));
  const prepared = facts.map((f) => ({ ...f, reason: lines[f.userId] }));
  await d.tx(async (q) => {
    for (const p of prepared) {
      await q.query(`insert into answers (whim_id, user_id, prepared, prepared_reason, facts) values ($1,$2,$3,$4,$5)`, [
        whim.id,
        p.userId,
        p.answer,
        p.reason,
        JSON.stringify({ facts: p.facts }),
      ]);
      await logEvent(q, {
        userId: p.userId,
        squadId,
        actor: "kitten",
        type: "answer.prepared",
        objectType: "whim",
        objectId: whim.id,
        payload: { what, prepared: p.answer, reason: p.reason },
        reason: "a friend floated a whim; I checked your calendar, budget and interests",
      });
    }
    await logEvent(q, {
      squadId,
      userId: ownerId,
      actor: "user",
      actorId: ownerId,
      type: "whim.floated",
      objectType: "whim",
      objectId: whim.id,
      payload: { what, needAtLeast: need },
      public: { text: `Someone in ${squad.name} floated: ${what}`, what, anonymous: true },
    });
  });
  return { whimId: whim.id, squadId, what, needAtLeast: need, invitees: invitees.length, priceCents: price, upToCents: upTo, perPersonCents: perPerson, startsAt, endsAt, parsed };
}

/** The owner's pending prepared answers (batched one-tap confirm, FR-KIT-4). */
export async function pendingAnswers(userId: string) {
  const d = await db();
  const rows = await d.query<{
    id: string; whim_id: string; what: string; prepared: string; prepared_reason: string; squad_name: string;
    price_cents: number | null; up_to_cents: number | null; need_at_least: number; starts_at: string | null; when_text: string | null;
  }>(
    `select a.id, a.whim_id, w.what, a.prepared, a.prepared_reason, s.name as squad_name,
            w.price_cents, w.up_to_cents, w.need_at_least, w.starts_at, w.when_text
     from answers a join whims w on w.id=a.whim_id join squads s on s.id=w.squad_id
     where a.user_id=$1 and a.confirmed is null and w.status='floating' order by a.created_at`,
    [userId],
  );
  // Each friend sees what it would cost them (owner request): the total split across "need at least".
  return rows.map((r) => {
    const perPersonCents = r.price_cents ? Math.ceil(r.price_cents / r.need_at_least) : r.up_to_cents;
    const shareText = r.price_cents
      ? `About $${(perPersonCents! / 100).toFixed(2)} each ($${(r.price_cents / 100).toFixed(2)} split ${r.need_at_least} ways; less if more join)`
      : r.up_to_cents
        ? `Up to $${(r.up_to_cents / 100).toFixed(2)} each`
        : "No price yet";
    return { ...r, perPersonCents, shareText };
  });
}

/**
 * The floater takes a whim back before it becomes a plan (edge-case pass, 8 Nov). Friends' unconfirmed answers drop
 * out of their lists; nobody is told who floated it (it was anonymous). Once it's a plan, the host cancels the plan.
 */
export async function withdrawWhim(ownerId: string, whimId: string) {
  const d = await db();
  const [w] = await d.query<{ owner_id: string; status: string; squad_id: string; what: string }>(`select owner_id, status, squad_id, what from whims where id=$1`, [whimId]);
  if (!w || w.owner_id !== ownerId) throw new Error("That isn't your whim.");
  if (w.status === "plan") throw new Error("It's already a plan. Cancel the plan instead.");
  if (w.status !== "floating") throw new Error("That whim isn't floating any more.");
  const r = await d.query(`update whims set status='withdrawn' where id=$1 and status='floating' returning id`, [whimId]);
  if (!r.length) throw new Error("It's already a plan. Cancel the plan instead.");
  await logEvent(d, { userId: ownerId, squadId: w.squad_id, actor: "user", actorId: ownerId, type: "whim.withdrawn", objectType: "whim", objectId: whimId, payload: { what: w.what, text: `You took back "${w.what}".` } });
  await logEvent(d, { squadId: w.squad_id, actor: "system", type: "whim.withdrawn", objectType: "whim", objectId: whimId, public: { text: `A whim was taken back: ${w.what}`, what: w.what } });
  return { ok: true };
}

/** One tap: confirm (or change) prepared answers. Answers are private; only counts move (FR-WHIM-5). */
export async function confirmAnswers(userId: string, items: { answerId: string; answer?: "yes" | "maybe" | "no" }[]) {
  const d = await db();
  const touched = new Set<string>();
  const joinedPlans: string[] = [];
  let skipped = 0;
  await d.tx(async (q) => {
    for (const it of items) {
      const [a] = await q.query<{ whim_id: string; prepared: string; user_id: string; whim_status: string; member: boolean }>(
        `select a.whim_id, a.prepared, a.user_id, w.status as whim_status,
                exists (select 1 from memberships m where m.squad_id=w.squad_id and m.user_id=a.user_id and m.left_at is null) as member
         from answers a join whims w on w.id=a.whim_id where a.id=$1`,
        [it.answerId],
      );
      if (!a || a.user_id !== userId) throw new Error("Not your answer.");
      // Withdrawn or faded, or you've left the squad: nothing to answer any more.
      if (!a.member || !["floating", "plan"].includes(a.whim_status)) {
        skipped++;
        continue;
      }
      const final = it.answer ?? (a.prepared as "yes" | "maybe" | "no");
      await q.query(`update answers set confirmed=$2, confirmed_at=now() where id=$1`, [it.answerId, final]);
      await logEvent(q, { userId, actor: "user", actorId: userId, type: "answer.confirmed", objectType: "whim", objectId: a.whim_id, payload: { answer: final } });
      if (a.whim_status === "floating") touched.add(a.whim_id);
      else {
        // It already became a plan while you were deciding: a late "yes" or "maybe" puts you in it as "thinking".
        const [p] = await q.query<{ id: string }>(`select id from plans where whim_id=$1 and status='open'`, [a.whim_id]);
        if (p) {
          // They were listed as "invited" when the plan was made; their answer now sets it (never overrides someone already in).
          await q.query(
            `insert into plan_members (plan_id, user_id, status) values ($1,$2,$3)
             on conflict (plan_id, user_id) do update set status=excluded.status where plan_members.status in ('invited','thinking')`,
            [p.id, userId, final === "no" ? "out" : "thinking"],
          );
          joinedPlans.push(p.id);
        }
      }
    }
  });
  if (items.length && skipped === items.length) throw new Error("That whim isn't open any more.");
  const converted: string[] = [];
  for (const whimId of touched) {
    const planId = await maybeConvert(whimId);
    if (planId) converted.push(planId);
  }
  return { confirmed: items.length - skipped, skipped, plansCreated: converted, joinedPlans };
}

/** When "need at least" people are in (floater + yes answers), the whim becomes a plan. */
async function maybeConvert(whimId: string): Promise<string | null> {
  const d = await db();
  const [w] = await d.query<{ id: string; owner_id: string; squad_id: string; what: string; status: string; need_at_least: number; starts_at: string | null; ends_at: string | null; price_cents: number | null; up_to_cents: number | null; place: string | null; image_url: string | null }>(
    `select * from whims where id=$1`,
    [whimId],
  );
  if (!w || w.status !== "floating") return null;
  // Only people still in the squad count (someone who left can't tip a whim into a plan).
  const [{ yes }] = await d.query<{ yes: number }>(
    `select count(*)::int as yes from answers a join memberships m on m.squad_id=$2 and m.user_id=a.user_id and m.left_at is null where a.whim_id=$1 and a.confirmed='yes'`,
    [whimId, w.squad_id],
  );
  if (yes + 1 < w.need_at_least) return null;
  const { createPlanFromWhim } = await import("./plans");
  return createPlanFromWhim(w);
}

/** Tick: whims that missed "need at least" fade; only the floater is told (FR-WHIM-6, AT-4). */
export async function fadeExpiredWhims(now = new Date()) {
  const d = await db();
  const due = await d.query<{ id: string; owner_id: string; what: string; squad_id: string }>(
    `select id, owner_id, what, squad_id from whims where status='floating' and expires_at < $1`,
    [now.toISOString()],
  );
  for (const w of due) {
    await d.tx(async (q) => {
      await q.query(`update whims set status='faded' where id=$1`, [w.id]);
      await logEvent(q, {
        userId: w.owner_id,
        squadId: w.squad_id,
        actor: "kitten",
        type: "whim.faded",
        objectType: "whim",
        objectId: w.id,
        payload: { what: w.what, text: "Not this time. Want me to try again next month?" },
        reason: "not enough friends said yes before it expired",
      });
    });
  }
  return due.length;
}
