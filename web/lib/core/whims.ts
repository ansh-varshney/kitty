import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { createSquad, directSquad, getKitten, isMember, listRules, sharesASquad, squadMembers } from "./users";
import { calendar, committedCents, monthSpentCents, windowOf } from "./month";
import { clash } from "../referee/time";
import { funBudgetCents, usuallyIn } from "../referee/rules";
import { parseWhim, reasonLines } from "../kitten/ai";
import { giveBack, setAside, shortOf, shortOfMany } from "./set-aside";
import { refillOrAsk } from "./money-flow";

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** What each person is asked to put in when they agree: the price each, or the total split across "need at least". */
export const shareOf = (w: { price_cents: number | null; up_to_cents?: number | null; price_mode: string | null; need_at_least: number }) =>
  w.price_cents != null ? (w.price_mode === "per_person" ? w.price_cents : Math.ceil(w.price_cents / Math.max(w.need_at_least, 1))) : (w.up_to_cents ?? 0);

/** Set a share aside for this whim and remember it (one row per person per whim). Inside a transaction. */
async function holdForWhim(q: Queryable, w: { id: string; squad_id: string; what: string; use_savings: boolean }, userId: string, cents: number) {
  if (cents <= 0) return;
  const h = await setAside(q, userId, cents, w.use_savings ? w.squad_id : null, `your share of ${w.what}`);
  await q.query(
    `insert into whim_holds (whim_id, user_id, jar_cents, savings_cents) values ($1,$2,$3,$4)
     on conflict (whim_id, user_id) do update set jar_cents=excluded.jar_cents, savings_cents=excluded.savings_cents, status='held'`,
    [w.id, userId, h.jarCents, h.savingsCents],
  );
  await logEvent(q, { userId, squadId: w.squad_id, actor: "kitten", type: "whim.set_aside", objectType: "whim", objectId: w.id, payload: { cents, text: `Your ${usd(cents)} for "${w.what}" is set aside from your Treat Jar. If it doesn't go ahead, it comes straight back.` }, reason: "you said yes" });
}

/** The whim isn't going ahead (or you're being asked again): every set-aside share goes back where it came from. */
export async function releaseWhimHolds(q: Queryable, whimId: string, why: string, onlyUserIds?: string[]) {
  const [w] = await q.query<{ squad_id: string; what: string }>(`select squad_id, what from whims where id=$1`, [whimId]);
  const holds = await q.query<{ user_id: string; jar_cents: number; savings_cents: number }>(
    `update whim_holds set status='released' where whim_id=$1 and status='held' and ($2::uuid[] is null or user_id = any($2::uuid[])) returning user_id, jar_cents, savings_cents`,
    [whimId, onlyUserIds ?? null],
  );
  for (const h of holds) {
    await giveBack(q, h.user_id, { jarCents: h.jar_cents, savingsCents: h.savings_cents }, w.squad_id, why);
    await logEvent(q, { userId: h.user_id, squadId: w.squad_id, actor: "kitten", type: "whim.released", objectType: "whim", objectId: whimId, payload: { cents: h.jar_cents + h.savings_cents, text: `Your ${usd(h.jar_cents + h.savings_cents)} for "${w.what}" is back in your Treat Jar: ${why}.` }, reason: why });
  }
}

/** Float a whim from the app: your own share is set aside first, and if the jar is short you're asked to refill before it goes out. */
export async function floatWhim(userId: string, input: WhimInput & { refill?: boolean }) {
  const { refill, ...body } = input;
  const d = await db();
  const headcount = body.squadId ? (await squadMembers(d, body.squadId)).length : (body.friendIds?.length ?? 0) + 1;
  const need = Math.max(2, body.needAtLeast ?? Math.ceil(headcount / 2));
  const price = body.priceCents ?? null;
  const share = shareOf({ price_cents: price, up_to_cents: body.upToCents ?? null, price_mode: body.priceMode ?? (price == null && body.upToCents != null ? "per_person" : "total"), need_at_least: need });
  if (share > 0) {
    const s = await shortOf(userId, share, body.useSavings && body.squadId ? body.squadId : null);
    if (s.shortCents > 0) {
      if (!refill) return { ok: false as const, code: "jar_short" as const, shortCents: s.shortCents, jarCents: s.jarCents };
      const [draft] = await d.query<{ id: string }>(`insert into whim_drafts (user_id, body) values ($1,$2) returning id`, [userId, JSON.stringify(body)]);
      return refillOrAsk(userId, s.shortCents, s.jarCents, { refill: true, after: `float:${draft.id}`, reason: `your share of ${body.what ?? "a whim"}` });
    }
  }
  return createWhim(userId, body);
}

/** After a refill: float the whim that was waiting for it. */
export async function floatDraft(userId: string, draftId: string) {
  const d = await db();
  const [draft] = await d.query<{ body: WhimInput }>(`delete from whim_drafts where id=$1 and user_id=$2 returning body`, [draftId, userId]);
  if (!draft) return null;
  return createWhim(userId, draft.body);
}

/** What saying yes to these answers would set aside, per whim. */
async function yesShares(q: Queryable, userId: string, items: { answerId: string; answer?: "yes" | "no" }[]) {
  const out: { answerId: string; cents: number; savingsSquad: string | null }[] = [];
  for (const it of items) {
    const [a] = await q.query<{ prepared: string; user_id: string; status: string; squad_id: string; use_savings: boolean; price_cents: number | null; up_to_cents: number | null; price_mode: string | null; need_at_least: number; confirmed: string | null }>(
      `select a.prepared, a.user_id, a.confirmed, w.status, w.squad_id, w.use_savings, w.price_cents, w.up_to_cents, w.price_mode, w.need_at_least from answers a join whims w on w.id=a.whim_id where a.id=$1`,
      [it.answerId],
    );
    if (!a || a.user_id !== userId || a.status !== "floating" || a.confirmed === "yes") continue;
    if ((it.answer ?? (a.prepared === "yes" ? "yes" : null)) !== "yes") continue;
    out.push({ answerId: it.answerId, cents: shareOf(a), savingsSquad: a.use_savings ? a.squad_id : null });
  }
  return out;
}

/** Answer from the app: a yes sets your share aside in the same step. If the jar is short, you're asked to refill first. */
export async function answerWhims(userId: string, items: { answerId: string; answer?: "yes" | "no" }[], refill?: boolean) {
  const d = await db();
  const yes = await yesShares(d, userId, items);
  const s = await shortOfMany(userId, yes);
  if (s.shortCents > 0) {
    if (!refill) return { ok: false as const, code: "jar_short" as const, shortCents: s.shortCents, jarCents: s.jarCents };
    return refillOrAsk(userId, s.shortCents, s.jarCents, { refill: true, after: `yes:${yes.slice(0, 2).map((y) => y.answerId).join(",")}`, reason: "your share" });
  }
  return confirmAnswers(userId, items);
}


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

export type Facts = { answer: "yes" | "negotiate"; facts: string[]; hardClash: boolean; overBudget: boolean };

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
  // Something in the way (calendar or budget) is what negotiating is for. Otherwise it looks good.
  const answer: Facts["answer"] = hardClash || overBudget || c.soft ? "negotiate" : "yes";
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
  place?: string;
  priceMode?: "total" | "per_person";
  decideBy?: string;
  bookerId?: string;
  imageUrl?: string;
  sourceUrl?: string;
  useSavings?: boolean;
};

/** The one deadline for a whim and its plan: everyone answers and pays by then. 2 days, or the day before it happens if that's sooner. */
export function deadlineFor(startsAt: string, now = Date.now()): string {
  const start = Date.parse(startsAt);
  const dayBefore = start - 24 * 3600_000;
  const twoDays = now + 48 * 3600_000;
  const t = dayBefore > now + 3600_000 ? Math.min(twoDays, dayBefore) : now + (start - now) / 2;
  return new Date(t).toISOString();
}

/** Create and float a whim: parse it, prepare every friend's answer, keep the floater anonymous (FR-WHIM-3/4/5). */
export async function createWhim(ownerId: string, input: WhimInput) {
  const d = await db();
  let squadId = input.squadId ?? null;
  if (!squadId && input.friendIds?.length) {
    for (const f of input.friendIds) if (!(await sharesASquad(d, ownerId, f))) throw new Error("You can only invite friends you share a squad with.");
    if (input.bookerId && ![ownerId, ...input.friendIds].includes(input.bookerId)) throw new Error("The person booking has to be one of the people invited.");
  } else if (!squadId) throw new Error("Pick a squad or some friends.");
  if (input.decideBy && Date.parse(input.decideBy) <= Date.now()) throw new Error("The decide-by time has to be in the future.");
  if (squadId && !(await isMember(d, squadId, ownerId))) throw new Error("You're not in that squad.");

  const [owner] = await d.query<{ tz: string; name: string }>(`select tz, name from users where id=$1`, [ownerId]);
  const parsed = input.text || input.imageBase64 || input.url ? await parseWhim({ ...input, tz: owner?.tz }) : null;
  const what = input.what ?? parsed?.what ?? "Something fun";
  // One friend: it lives in the chat with them. Several chosen friends: a mini-squad, because they need somewhere to talk.
  const directFriend = !squadId && input.friendIds?.length === 1 ? input.friendIds[0] : null;
  if (!squadId) {
    const place = directFriend ? await directSquad(d, ownerId, directFriend) : await createSquad(d, ownerId, what, { kind: "mini", memberIds: input.friendIds });
    squadId = place.id;
  }
  const [squad] = await d.query<{ name: string; kind: string }>(`select name, kind from squads where id=$1`, [squadId]);
  const members = await squadMembers(d, squadId);
  const invitees = members.filter((m) => m.id !== ownerId);
  if (input.bookerId && !members.some((m) => m.id === input.bookerId)) throw new Error("The person booking has to be one of the people invited.");
  const need = Math.max(2, input.needAtLeast ?? Math.ceil(members.length / 2));
  if (need > members.length) throw new Error(`Only ${members.length} people are in this group, so "need at least" can be ${members.length} at most.`);
  const startsAt = input.startsAt ?? parsed?.startsAt ?? null;
  const endsAt = input.endsAt ?? parsed?.endsAt ?? null;
  const upTo = input.upToCents ?? parsed?.upToCents ?? null;
  const price = input.priceCents ?? parsed?.priceCents ?? null;
  const priceMode = input.priceMode ?? (price == null && upTo != null ? "per_person" : "total");
  const perPerson = price != null ? (priceMode === "per_person" ? price : Math.ceil(price / Math.max(need, 1))) : upTo;
  const place = (input.place ?? parsed?.place ?? "").trim();
  // What everyone is deciding on has to be complete (owner, 10 Nov): when, where and how much.
  if (!startsAt) throw new Error("Pick a date and time first.");
  if (Date.parse(startsAt) <= Date.now()) throw new Error("That time has already passed.");
  if (!place) throw new Error("Add a place first.");
  if (!price && !upTo) throw new Error("Add a price first.");
  if (input.decideBy && Date.parse(input.decideBy) >= Date.parse(startsAt)) throw new Error("The deadline has to be before it happens.");
  const decideBy = input.decideBy ?? deadlineFor(startsAt);
  // The floater is in from the start, so their share is set aside now (FR-JAR-8). floatWhim asked for a refill already if needed.
  const myShare = shareOf({ price_cents: price, up_to_cents: upTo, price_mode: priceMode, need_at_least: need });
  if (myShare > 0 && (await shortOf(ownerId, myShare, input.useSavings ? squadId : null)).shortCents > 0) throw new Error(`Your Treat Jar is short for your ${usd(myShare)} share. Top it up first.`);

  const [whim] = await d.query<{ id: string }>(
    `insert into whims (owner_id, squad_id, what, when_text, starts_at, ends_at, up_to_cents, place, price_cents, image_url, source_url, need_at_least, price_mode, pounce_rule, decide_by, booker_id, use_savings, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'host',$14,$15,$16,$14) returning id`,
    [ownerId, squadId, what, input.whenText ?? parsed?.whenText ?? null, startsAt, endsAt, upTo, place, price, input.imageUrl ?? parsed?.imageUrl ?? null, input.sourceUrl ?? parsed?.sourceUrl ?? null, need, priceMode, decideBy, input.bookerId ?? null, Boolean(input.useSavings)],
  );

  await d.tx((q) => holdForWhim(q, { id: whim.id, squad_id: squadId!, what, use_savings: Boolean(input.useSavings) }, ownerId, myShare));

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
  if (directFriend) {
    const [friend] = await d.query<{ name: string }>(`select name from users where id=$1`, [directFriend]);
    const when = startsAt ? new Date(startsAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: owner?.tz ?? "UTC" }) : (input.whenText ?? parsed?.whenText ?? null);
    const cost = price != null ? `$${(price / 100).toFixed(2)} ${priceMode === "per_person" ? "each" : "in total"}` : null;
    const talk = async (from: string, to: string, text: string) => d.query(`insert into direct_messages (from_user, to_user, from_kind, to_kind, text) values ($1,$2,'kitten','kitten',$3)`, [from, to, text]);
    await talk(ownerId, directFriend, `${owner?.name} wants to do this with ${friend?.name}: ${[what, when, cost].filter(Boolean).join(", ")}.`);
    await talk(directFriend, ownerId, `Got it. I'll check with ${friend?.name}.`);
  }
  return { friendId: directFriend, whimId: whim.id, squadId, what, needAtLeast: need, invitees: invitees.length, priceCents: price, upToCents: upTo, perPersonCents: perPerson, startsAt, endsAt, parsed };
}

/** The owner's pending prepared answers (batched one-tap confirm, FR-KIT-4). */
export async function pendingAnswers(userId: string) {
  const d = await db();
  const rows = await d.query<{
    id: string; whim_id: string; what: string; prepared: string; prepared_reason: string; squad_name: string;
    price_cents: number | null; up_to_cents: number | null; need_at_least: number; starts_at: string | null; when_text: string | null; price_mode: string | null;
    owner_id: string; owner_name: string; squad_kind: string; place: string | null; version: number; negotiated: boolean;
  }>(
    `select a.id, a.whim_id, w.what, a.prepared, a.prepared_reason, s.name as squad_name, w.place, w.version, a.negotiated,
            w.price_cents, w.up_to_cents, w.need_at_least, w.starts_at, w.when_text, w.price_mode, w.owner_id, o.name as owner_name, s.kind as squad_kind
     from answers a join whims w on w.id=a.whim_id join squads s on s.id=w.squad_id join users o on o.id=w.owner_id
     where a.user_id=$1 and a.confirmed is null and w.status='floating'
       and not exists (select 1 from whim_negotiations n where n.whim_id=a.whim_id and n.user_id=a.user_id and n.status='with_host')
     order by a.created_at`,
    [userId],
  );
  // Each friend sees what it would cost them (owner request): the total split across "need at least".
  return rows.map((r) => {
    const each = r.price_mode === "per_person" && r.price_cents != null;
    const perPersonCents = each ? r.price_cents : r.price_cents ? Math.ceil(r.price_cents / r.need_at_least) : r.up_to_cents;
    const shareText = each
      ? `$${(r.price_cents! / 100).toFixed(2)} each`
      : r.price_cents
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
  const r = await d.tx(async (q) => {
    const flipped = await q.query(`update whims set status='withdrawn' where id=$1 and status='floating' returning id`, [whimId]);
    if (flipped.length) await releaseWhimHolds(q, whimId, "it was taken back");
    return flipped;
  });
  if (!r.length) throw new Error("It's already a plan. Cancel the plan instead.");
  await logEvent(d, { userId: ownerId, squadId: w.squad_id, actor: "user", actorId: ownerId, type: "whim.withdrawn", objectType: "whim", objectId: whimId, payload: { what: w.what, text: `You took back "${w.what}".` } });
  await logEvent(d, { squadId: w.squad_id, actor: "system", type: "whim.withdrawn", objectType: "whim", objectId: whimId, public: { text: `A whim was taken back: ${w.what}`, what: w.what } });
  return { ok: true };
}

/** One tap: confirm (or change) prepared answers. Answers are private; only counts move (FR-WHIM-5). */
export async function confirmAnswers(userId: string, items: { answerId: string; answer?: "yes" | "no" }[]) {
  const d = await db();
  // A yes is a yes to paying (FR-JAR-8): the money has to be there before anything is confirmed.
  const yes = await yesShares(d, userId, items);
  const short = await shortOfMany(userId, yes);
  if (short.shortCents > 0) throw new Error(`Your Treat Jar is ${usd(short.shortCents)} short. Top it up first.`);
  const touched = new Set<string>();
  let skipped = 0;
  await d.tx(async (q) => {
    for (const it of items) {
      const [a] = await q.query<{ whim_id: string; what: string; prepared: string; user_id: string; whim_status: string; member: boolean; starts_at: string | null; ends_at: string | null }>(
        `select a.whim_id, w.what, a.prepared, a.user_id, w.status as whim_status, w.starts_at, w.ends_at,
                exists (select 1 from memberships m where m.squad_id=w.squad_id and m.user_id=a.user_id and m.left_at is null) as member
         from answers a join whims w on w.id=a.whim_id where a.id=$1`,
        [it.answerId],
      );
      if (!a || a.user_id !== userId) throw new Error("Not your answer.");
      // Decided, withdrawn or faded, or you've left the squad: nothing to answer any more.
      if (!a.member || a.whim_status !== "floating") {
        skipped++;
        continue;
      }
      // One tap on "send my answers" only sends the ones the kitten was sure about.
      const final = it.answer ?? (a.prepared === "yes" ? "yes" : null);
      if (!final) continue;
      if (final === "yes") {
        // No double booking (FR-CAL-2): a yes here is a promise to be there.
        const cal = await calendar(q, userId);
        const c = clash(windowOf(a.starts_at, a.ends_at), cal.plansIn, []);
        if (c.hard) throw new Error(`You're already in ${cal.plansIn.find((p) => p.planId === c.hard!.planId)?.title ?? "another plan"} then. Say no, or ask your kitten to negotiate.`);
      }
      await q.query(`update answers set confirmed=$2, confirmed_at=now() where id=$1`, [it.answerId, final]);
      const [already] = await q.query(`select 1 from whim_holds where whim_id=$1 and user_id=$2 and status='held'`, [a.whim_id, userId]);
      if (final === "yes" && !already) {
        const [w] = await q.query<{ id: string; squad_id: string; what: string; use_savings: boolean; price_cents: number | null; up_to_cents: number | null; price_mode: string | null; need_at_least: number }>(`select id, squad_id, what, use_savings, price_cents, up_to_cents, price_mode, need_at_least from whims where id=$1`, [a.whim_id]);
        await holdForWhim(q, w, userId, shareOf(w));
      }
      if (final === "no" && already) await releaseWhimHolds(q, a.whim_id, "you said no", [userId]);
      await logEvent(q, { userId, actor: "user", actorId: userId, type: "answer.confirmed", objectType: "whim", objectId: a.whim_id, payload: { answer: final } });
      touched.add(a.whim_id);
    }
  });
  if (items.length && skipped === items.length) throw new Error("That whim isn't open any more. If it became a plan, you can tag along from there.");
  const converted: string[] = [];
  for (const whimId of touched) {
    const planId = await maybeConvert(whimId);
    if (planId) converted.push(planId);
  }
  return { confirmed: items.length - skipped, skipped, plansCreated: converted };
}

/** A negotiation changed the whim, so everyone's kitten looks again and everyone is asked again on the new version. */
export async function recheckAnswers(whimId: string) {
  const d = await db();
  const [w] = await d.query<{ what: string; squad_id: string; starts_at: string | null; ends_at: string | null; price_cents: number | null; up_to_cents: number | null; price_mode: string | null; need_at_least: number }>(`select what, squad_id, starts_at, ends_at, price_cents, up_to_cents, price_mode, need_at_least from whims where id=$1`, [whimId]);
  const [squad] = await d.query<{ name: string }>(`select name from squads where id=$1`, [w.squad_id]);
  const per = w.price_cents != null ? (w.price_mode === "per_person" ? w.price_cents : Math.ceil(w.price_cents / Math.max(w.need_at_least, 1))) : w.up_to_cents;
  const rows = await d.query<{ id: string; user_id: string }>(`select id, user_id from answers where whim_id=$1`, [whimId]);
  const facts = await Promise.all(
    rows.map(async (a) => {
      const f = await prepareFacts(d, a.user_id, { squadId: w.squad_id, squadName: squad.name, what: w.what, startsAt: w.starts_at, endsAt: w.ends_at, perPersonCents: per });
      const kitten = await getKitten(d, a.user_id);
      return { ...a, breed: kitten?.breed ?? "tabby", ...f };
    }),
  );
  const lines = await reasonLines(facts.map((f) => ({ id: f.user_id, breed: f.breed, answer: f.answer, facts: f.facts })));
  // The floater stays in: their set-aside share follows the new price (the extra goes back, or more is set aside if the jar has it).
  const [hw] = await d.query<{ owner_id: string; use_savings: boolean }>(`select owner_id, use_savings from whims where id=$1`, [whimId]);
  const hostShare = shareOf(w);
  const [hostHold] = await d.query<{ c: number }>(`select (jar_cents + savings_cents)::int as c from whim_holds where whim_id=$1 and user_id=$2 and status='held'`, [whimId, hw.owner_id]);
  const hostCanCover = !hostHold || hostShare <= hostHold.c || (await shortOf(hw.owner_id, hostShare, hw.use_savings ? w.squad_id : null)).shortCents === 0;
  await d.tx(async (q) => {
    if (hostHold && hostHold.c !== hostShare && hostCanCover) {
      const [h] = await q.query<{ jar_cents: number; savings_cents: number }>(`update whim_holds set status='released' where whim_id=$1 and user_id=$2 and status='held' returning jar_cents, savings_cents`, [whimId, hw.owner_id]);
      await giveBack(q, hw.owner_id, { jarCents: h.jar_cents, savingsCents: h.savings_cents }, w.squad_id, "the price changed");
      await holdForWhim(q, { id: whimId, squad_id: w.squad_id, what: w.what, use_savings: hw.use_savings }, hw.owner_id, hostShare);
    }
    // Everyone is asked again on the new version, so anything they'd set aside goes back until they say yes again.
    await releaseWhimHolds(q, whimId, "the whim changed, so you're being asked again", rows.map((r) => r.user_id));
    for (const f of facts) {
      await q.query(`update answers set prepared=$2, prepared_reason=$3, facts=$4, confirmed=null, confirmed_at=null where id=$1`, [f.id, f.answer, lines[f.user_id], JSON.stringify({ facts: f.facts })]);
      await logEvent(q, { userId: f.user_id, squadId: w.squad_id, actor: "kitten", type: "answer.prepared", objectType: "whim", objectId: whimId, payload: { what: w.what, prepared: f.answer, reason: lines[f.user_id] }, reason: "the whim changed, so I checked again" });
    }
  });
}

/** When "need at least" people are in (floater + yes answers) and nobody is still negotiating, the whim becomes a plan. */
export async function maybeConvert(whimId: string): Promise<string | null> {
  const d = await db();
  const [w] = await d.query<{ id: string; owner_id: string; squad_id: string; what: string; status: string; need_at_least: number; price_mode: string | null; pounce_rule: string | null; decide_by: string | null; booker_id: string | null; starts_at: string | null; ends_at: string | null; price_cents: number | null; up_to_cents: number | null; place: string | null; image_url: string | null }>(
    `select * from whims where id=$1`,
    [whimId],
  );
  if (!w || w.status !== "floating") return null;
  // Nothing is decided while the kittens are still talking.
  if ((await d.query(`select 1 from whim_negotiations where whim_id=$1 and status='with_host'`, [whimId])).length) return null;
  // Only people still in the squad count (someone who left can't tip a whim into a plan).
  const [{ yes, open }] = await d.query<{ yes: number; open: number }>(
    `select count(*) filter (where a.confirmed='yes')::int as yes, count(*) filter (where a.confirmed is null)::int as open
     from answers a join memberships m on m.squad_id=$2 and m.user_id=a.user_id and m.left_at is null where a.whim_id=$1`,
    [whimId, w.squad_id],
  );
  if (yes + 1 >= w.need_at_least) {
    const { createPlanFromWhim } = await import("./plans");
    return createPlanFromWhim(w);
  }
  // Too many said no for it ever to get there: tell the floater now instead of waiting for the deadline.
  if (yes + open + 1 < w.need_at_least) {
    const faded = await d.tx(async (q) => {
      const f = await q.query(`update whims set status='faded' where id=$1 and status='floating' returning id`, [whimId]);
      if (f.length) await releaseWhimHolds(q, whimId, "not enough friends can make it");
      return f;
    });
    if (faded.length) await logEvent(d, { userId: w.owner_id, squadId: w.squad_id, actor: "kitten", type: "whim.faded", objectType: "whim", objectId: whimId, payload: { what: w.what, text: `Not enough friends can make "${w.what}". Want to try another time?` }, reason: "not enough friends said yes" });
  }
  return null;
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
      await q.query(`update whim_negotiations set status='closed' where whim_id=$1 and status='with_host'`, [w.id]);
      await releaseWhimHolds(q, w.id, "not enough friends said yes by the deadline");
      await logEvent(q, {
        userId: w.owner_id,
        squadId: w.squad_id,
        actor: "kitten",
        type: "whim.faded",
        objectType: "whim",
        objectId: w.id,
        payload: { what: w.what, text: `Not enough friends said yes to "${w.what}" by the deadline. Want to try again?` },
        reason: "not enough friends said yes before the deadline",
      });
    });
  }
  return due.length;
}
