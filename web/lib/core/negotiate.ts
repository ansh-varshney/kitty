import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { calendar, committedCents, monthSpentCents, windowOf } from "./month";
import { getKitten, getUser, isMember, listRules } from "./users";
import { maybeConvert, pendingAnswers, recheckAnswers } from "./whims";
import { answerCard, negotiationCards } from "./meows";
import { withLock } from "./locks";
import { funBudgetCents } from "../referee/rules";
import { MAX_WHIM_CHANGES, negotiate, shareOf, type Ask, type Person, type Terms } from "../referee/negotiate";
import { validTz } from "../referee/time";
import { parseWhim } from "../kitten/ai";

/**
 * Kittens negotiating a whim before it becomes a plan (PRD §B7, FR-NEG-9..13). The logic is in referee/negotiate.ts;
 * this runs it, writes the kitten-to-kitten conversation everyone can read on the whim, and brings in a person
 * whenever one has to decide. Budgets and reasons are never written down: only what's being asked for.
 */

type Whim = { id: string; owner_id: string; squad_id: string; what: string; status: string; need_at_least: number; price_cents: number | null; up_to_cents: number | null; price_mode: string | null; starts_at: string | null; ends_at: string | null; decide_by: string | null; version: number; place: string | null };
type Proposal = { startsAt?: string; endsAt?: string; priceCents?: number };

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const whenText = (iso: string | Date, tz: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

export async function say(q: Queryable, whimId: string, fromUser: string, text: string) {
  await q.query(`insert into whim_talk (whim_id, from_user, text) values ($1,$2,$3)`, [whimId, fromUser, text]);
}

async function personFor(d: Queryable, userId: string, withBudget = false): Promise<Person> {
  const cal = await calendar(d, userId);
  let spareCents: number | null = null;
  if (withBudget) {
    const budget = funBudgetCents(await listRules(d, userId));
    if (budget != null) spareCents = budget - (await monthSpentCents(d, userId)) - (await committedCents(d, userId));
  }
  return { id: userId, plansIn: cal.plansIn, busy: cal.busy, spareCents };
}

/** "Can we do Sunday?" or "$20 each": what the person asked for in the kitten chat, read the same way as a whim. */
async function readWish(text: string, terms: Terms, tz: string): Promise<Ask | undefined> {
  const p = await parseWhim({ text, tz }).catch(() => null);
  if (!p) return undefined;
  const wish: Ask = {};
  if (p.startsAt && terms.window) {
    const start = new Date(p.startsAt);
    wish.window = { start, end: new Date(start.getTime() + (terms.window.end.getTime() - terms.window.start.getTime())) };
  }
  if (p.upToCents) wish.priceCents = terms.priceMode === "per_person" ? p.upToCents : p.upToCents * Math.max(terms.ways, 1);
  else if (p.priceCents) wish.priceCents = p.priceCents;
  return wish.window || wish.priceCents ? wish : undefined;
}

/** "Ask my kitten to negotiate." One try per person, one negotiation at a time, two changes per whim at most. */
export async function askToNegotiate(userId: string, whimId: string, wishText?: string) {
  return withLock(`whim:${whimId}`, () => negotiateNow(userId, whimId, wishText));
}

async function negotiateNow(userId: string, whimId: string, wishText?: string) {
  const d = await db();
  const [w] = await d.query<Whim>(`select * from whims where id=$1`, [whimId]);
  if (!w) throw new Error("That whim isn't here any more.");
  if (w.status !== "floating") throw new Error("This one has already been decided.");
  const [a] = await d.query<{ id: string; negotiated: boolean }>(`select id, negotiated from answers where whim_id=$1 and user_id=$2`, [whimId, userId]);
  if (!a) throw new Error("This whim isn't for you.");
  if (a.negotiated) return { status: "limit", message: "I've already asked once on this one. It's yes or no now." };
  if (w.version >= MAX_WHIM_CHANGES) return { status: "limit", message: "This one has changed twice already. It's yes or no now." };
  if ((await d.query(`select 1 from whim_negotiations where whim_id=$1 and status='with_host'`, [whimId])).length) {
    return { status: "busy", message: "Another kitten is talking to the host about this. Ask me again once that's done." };
  }

  const [me, host] = await Promise.all([getUser(d, userId), getUser(d, w.owner_id)]);
  const myKitten = (await getKitten(d, userId))?.name ?? "Your kitten";
  const asker = me?.name ?? "them";
  const hostName = host?.name ?? "the host";
  const tz = validTz(host?.tz);
  const terms: Terms = { window: windowOf(w.starts_at, w.ends_at), priceCents: w.price_cents ?? w.up_to_cents ?? 0, priceMode: (w.price_mode ?? "total") as Terms["priceMode"], ways: w.need_at_least };
  const others = await d.query<{ user_id: string }>(`select user_id from answers where whim_id=$1 and user_id<>$2 and coalesce(confirmed,'') <> 'no'`, [whimId, userId]);
  const [askerP, hostP, ...restP] = await Promise.all([personFor(d, userId, true), personFor(d, w.owner_id), ...others.map((o) => personFor(d, o.user_id))]);
  const wish = wishText?.trim() ? await readWish(wishText, terms, validTz(me?.tz)) : undefined;
  const notBefore = new Date(Math.max(Date.now(), w.decide_by ? Date.parse(w.decide_by) : 0));
  const out = negotiate({ asker: askerP, host: hostP, others: restP, terms, notBefore, wish });

  if (out.kind === "fits") return { status: "fits", message: "This already fits your calendar and budget, so there's nothing for me to ask for." };

  if (out.kind === "stuck") {
    await d.tx(async (q) => {
      await q.query(`update answers set negotiated=true where id=$1`, [a.id]);
      await say(q, whimId, userId, out.on === "time" ? `${asker} can't make this time, and I couldn't find another day in the next two weeks that works. Over to ${asker}.` : `This costs more than works for ${asker}, and the gap is too big for me to ask for. Over to ${asker}.`);
      await logEvent(q, { userId, squadId: w.squad_id, actor: "kitten", type: "whim.negotiation_stuck", objectType: "whim", objectId: whimId, payload: { text: `I couldn't find a change to "${w.what}" that works for you, so it's your call: yes or no.` }, reason: "there was nothing I could ask for" });
      await logEvent(q, { userId: w.owner_id, squadId: w.squad_id, actor: "kitten", type: "whim.negotiation_stuck", objectType: "whim", objectId: whimId, payload: { text: `${asker}'s kitten looked for another way to do "${w.what}" and couldn't find one.` }, reason: "there was nothing they could ask for" });
    });
    return { status: "stuck", message: "I couldn't find a change that works. It's your call now." };
  }

  const proposal: Proposal = {
    ...(out.ask.window ? { startsAt: out.ask.window.start.toISOString(), endsAt: out.ask.window.end.toISOString() } : {}),
    ...(out.ask.priceCents != null ? { priceCents: out.ask.priceCents } : {}),
  };
  await d.tx(async (q) => {
    await q.query(`insert into whim_negotiations (whim_id, user_id, proposal) values ($1,$2,$3)`, [whimId, userId, JSON.stringify(proposal)]);
    await q.query(`update answers set negotiated=true where id=$1`, [a.id]);
    if (out.ask.window) {
      const when = whenText(out.ask.window.start, tz);
      if (out.askedFirst) {
        await say(q, whimId, userId, `This time doesn't work for ${asker}. ${whenText(out.askedFirst.start, tz)} does. Can we move it?`);
        await say(q, whimId, w.owner_id, `${hostName} can't do that one. ${when} works for ${hostName}. Would that suit ${asker}?`);
        await say(q, whimId, userId, `Yes, that works for ${asker}.`);
      } else {
        await say(q, whimId, userId, `${wish?.window ? `${asker} would rather do` : `This time doesn't work for ${asker}.`} ${when}${wish?.window ? "." : " does."} It suits ${out.fits} of ${out.of} people. Can we move it?`);
      }
    }
    if (out.ask.priceCents != null) {
      const eachWord = terms.priceMode === "per_person" || terms.ways > 1 ? " each" : "";
      await say(q, whimId, userId, `${fmt(shareOf(terms, terms.priceCents))}${eachWord} is more than works for ${asker}. Could it come down to ${fmt(shareOf(terms, out.ask.priceCents))}${eachWord}?`);
    }
    await say(q, whimId, w.owner_id, `Let me ask ${hostName}.`);
    await logEvent(q, { userId, squadId: w.squad_id, actor: "kitten", type: "whim.negotiating", objectType: "whim", objectId: whimId, payload: { text: `I asked ${hostName}'s kitten about "${w.what}". I'll tell you what they say.` }, reason: "you asked me to negotiate" });
  });
  return { status: "asked", message: `${myKitten} is on it.` };
}

/** The host answers: Accept changes the whim and everyone is asked again; Keep leaves it as it was. */
export async function answerNegotiation(hostId: string, negotiationId: string, accept: boolean) {
  const d = await db();
  const [n0] = await d.query<{ whim_id: string }>(`select whim_id from whim_negotiations where id=$1`, [negotiationId]);
  if (!n0) throw new Error("That negotiation isn't here any more.");
  const out = await withLock(`whim:${n0.whim_id}`, () => answerNow(hostId, negotiationId, accept));
  // Outside the whim's lock: this may turn the whim into a plan and start collecting money.
  await maybeConvert(n0.whim_id);
  return out;
}

async function answerNow(hostId: string, negotiationId: string, accept: boolean) {
  const d = await db();
  const [n] = await d.query<{ whim_id: string; user_id: string; status: string; proposal: Proposal }>(`select whim_id, user_id, status, proposal from whim_negotiations where id=$1`, [negotiationId]);
  const [w] = await d.query<Whim>(`select * from whims where id=$1`, [n.whim_id]);
  if (w.owner_id !== hostId) throw new Error("Only the person who floated it can answer.");
  if (n.status !== "with_host" || w.status !== "floating") throw new Error("That's already been answered.");
  const [host, asker] = await Promise.all([getUser(d, hostId), getUser(d, n.user_id)]);
  const hostName = host?.name ?? "The host";
  const askerName = asker?.name ?? "them";
  const tz = validTz(host?.tz);

  if (!accept) {
    await d.tx(async (q) => {
      await q.query(`update whim_negotiations set status='kept' where id=$1`, [negotiationId]);
      await say(q, w.id, hostId, `${hostName} would like to keep it as it is. Over to ${askerName}: yes or no.`);
      await logEvent(q, { userId: n.user_id, squadId: w.squad_id, actor: "kitten", type: "whim.kept", objectType: "whim", objectId: w.id, payload: { text: `${hostName} kept "${w.what}" as it is. It's yes or no now.` }, reason: "the host answered your negotiation" });
    });
    return { ok: true, message: "Kept as it is." };
  }

  const p = n.proposal;
  const version = w.version + 1;
  await d.tx(async (q) => {
    await q.query(
      `update whims set starts_at=coalesce($2,starts_at), ends_at=coalesce($3,ends_at), price_cents=coalesce($4,price_cents), version=$5 where id=$1`,
      [w.id, p.startsAt ?? null, p.endsAt ?? null, p.priceCents ?? null, version],
    );
    await q.query(`update whim_negotiations set status='accepted' where id=$1`, [negotiationId]);
    const changed = [p.startsAt ? whenText(p.startsAt, tz) : null, p.priceCents != null ? `${fmt(p.priceCents)}${(w.price_mode ?? "total") === "per_person" ? " each" : " in total"}` : null].filter(Boolean).join(", ");
    await say(q, w.id, hostId, `${hostName} said yes. It's now ${changed}. Everyone's kittens are checking again.`);
    if (version >= MAX_WHIM_CHANGES) await say(q, w.id, hostId, `That's ${MAX_WHIM_CHANGES} changes, so we'll stop here. It's yes or no for everyone now.`);
  });
  await recheckAnswers(w.id);
  return { ok: true, message: "Changed. Everyone's being asked again." };
}

/** Everything about a whim that a person in it can see, including the kittens' conversation (fixed: nobody can type here). */
export async function whimView(userId: string, whimId: string) {
  const d = await db();
  const [w] = await d.query<Whim & { use_savings: boolean; when_text: string | null; created_at: string }>(`select * from whims where id=$1`, [whimId]);
  if (!w || !(await isMember(d, w.squad_id, userId))) throw new Error("You can't see this whim.");
  const [counts] = await d.query<{ yes: number; total: number }>(`select count(*) filter (where confirmed='yes')::int as yes, count(*)::int as total from answers where whim_id=$1`, [whimId]);
  const [place] = await d.query<{ kind: string }>(`select kind from squads where id=$1`, [w.squad_id]);
  const talk = await d.query<{ id: string; from_user: string; text: string; created_at: string; owner: string; kitten: string | null; look: Record<string, unknown> | null }>(
    `select t.id, t.from_user, t.text, t.created_at, u.name as owner, k.name as kitten, k.look from whim_talk t join users u on u.id=t.from_user left join kittens k on k.user_id=t.from_user where t.whim_id=$1 order by t.id`,
    [whimId],
  );
  const [plan] = await d.query<{ id: string }>(`select id from plans where whim_id=$1 limit 1`, [whimId]);
  const me = await getUser(d, userId);
  const kitten = await getKitten(d, userId);
  const tz = validTz(me?.tz);
  const mine = (await pendingAnswers(userId)).find((a) => a.whim_id === whimId);
  const cards = [...(mine ? [answerCard(mine, kitten?.name ?? "my kitten", tz)] : []), ...(await negotiationCards(d, userId, tz)).filter((c) => c.whim?.id === whimId)];
  const [waiting] = await d.query(`select 1 as x from whim_negotiations where whim_id=$1 and user_id=$2 and status='with_host'`, [whimId, userId]);
  const per = (w.price_mode ?? "total") === "per_person";
  const price = w.price_cents ?? w.up_to_cents ?? 0;
  const friend = place?.kind === "direct" ? (await d.query<{ user_id: string }>(`select user_id from memberships where squad_id=$1 and user_id<>$2 limit 1`, [w.squad_id, userId]))[0]?.user_id : null;
  return {
    whim: { id: w.id, what: w.what, place: w.place, startsAt: w.starts_at, whenText: w.when_text, priceCents: price, priceMode: per ? "per_person" : "total", needAtLeast: w.need_at_least, decideBy: w.decide_by, status: w.status, squadId: w.squad_id, withFriend: friend ?? null, useSavings: w.use_savings, shareCents: per ? price : Math.ceil(price / Math.max(w.need_at_least, 1)) },
    mine: w.owner_id === userId,
    counts,
    cards,
    waitingOnHost: Boolean(waiting),
    planId: plan?.id ?? null,
    talk: talk.map((t) => ({ id: Number(t.id), text: t.text, at: t.created_at, owner: t.owner, kitten: t.kitten ?? "A kitten", look: t.look, isMine: t.from_user === userId })),
  };
}

/** A squad's whims still being decided, for its Plans tab. */
export async function squadWhims(userId: string, squadId: string) {
  const d = await db();
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  return d.query<{ id: string; what: string; starts_at: string | null; decide_by: string | null; talk: number; yes: number; total: number; need_at_least: number }>(
    `select w.id, w.what, w.starts_at, w.decide_by, w.need_at_least, (select count(*)::int from whim_talk t where t.whim_id=w.id) as talk,
       (select count(*)::int from answers a where a.whim_id=w.id and a.confirmed='yes') as yes, (select count(*)::int from answers a where a.whim_id=w.id) as total
     from whims w where w.squad_id=$1 and w.status='floating' order by w.created_at desc`,
    [squadId],
  );
}
