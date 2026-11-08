import { z } from "zod";
import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { getKitten } from "./users";
import { calendar, windowOf } from "./month";
import { prepareFacts } from "./whims";
import { expectedShare, shareLadder, type CostModel } from "../referee/shares";
import { acceptSuggestion as guard, clash, pickOption, type Option, type Voter } from "../referee/time";
import { reasonLines } from "../kitten/ai";

/** Plans and pots (PRD §B7 changing a plan, §B8, FR-PLAN-*, FR-NEG-5..8). */

export type PlanRow = {
  id: string;
  whim_id: string | null;
  squad_id: string;
  host_id: string;
  booker_id: string;
  title: string;
  image_url: string | null;
  place: string | null;
  starts_at: string | null;
  ends_at: string | null;
  price_mode: "total" | "per_person";
  price_cents: number;
  split_mode: "equal" | "custom" | "weights";
  need_at_least: number;
  pounce_rule: "everyone" | "at_least" | "host";
  decide_by: string;
  refund_until: string | null;
  status: string;
  locked_at: string | null;
  paw_up_round: number;
  pawup_until: string | null;
  version: number;
};

export async function getPlan(q: Queryable, id: string): Promise<PlanRow> {
  const [p] = await q.query<PlanRow>(`select * from plans where id=$1`, [id]);
  if (!p) throw new Error("Plan not found");
  return p;
}

export const costOf = (p: Pick<PlanRow, "price_mode" | "price_cents" | "split_mode">): CostModel => ({
  priceMode: p.price_mode,
  priceCents: p.price_cents,
  splitMode: p.split_mode,
});

export async function createPlanFromWhim(w: {
  id: string;
  owner_id: string;
  squad_id: string;
  what: string;
  need_at_least: number;
  starts_at: string | null;
  ends_at: string | null;
  price_cents: number | null;
  place: string | null;
  image_url: string | null;
}): Promise<string> {
  const d = await db();
  return d.tx(async (q) => {
    const flipped = await q.query(`update whims set status='plan' where id=$1 and status='floating' returning id`, [w.id]);
    if (!flipped.length) return "";
    const decideBy = new Date(Date.now() + 48 * 3600_000);
    if (w.starts_at) {
      const dayBefore = new Date(new Date(w.starts_at).getTime() - 24 * 3600_000);
      if (dayBefore < decideBy && dayBefore.getTime() > Date.now() + 3600_000) decideBy.setTime(dayBefore.getTime());
    }
    const [plan] = await q.query<{ id: string }>(
      `insert into plans (whim_id, squad_id, host_id, booker_id, title, image_url, place, starts_at, ends_at, price_cents, need_at_least, decide_by)
       values ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
      [w.id, w.squad_id, w.owner_id, w.what, w.image_url, w.place, w.starts_at, w.ends_at, w.price_cents ?? 0, w.need_at_least, decideBy.toISOString()],
    );
    const answers = await q.query<{ user_id: string; confirmed: string | null }>(
      `select a.user_id, a.confirmed from answers a join memberships m on m.squad_id=$2 and m.user_id=a.user_id and m.left_at is null where a.whim_id=$1`,
      [w.id, w.squad_id],
    );
    await q.query(`insert into plan_members (plan_id, user_id, status) values ($1,$2,'thinking')`, [plan.id, w.owner_id]);
    for (const a of answers) {
      const status = a.confirmed === "yes" || a.confirmed === "maybe" ? "thinking" : a.confirmed === "no" ? "out" : "invited";
      await q.query(`insert into plan_members (plan_id, user_id, status) values ($1,$2,$3) on conflict do nothing`, [plan.id, a.user_id, status]);
    }
    const [owner] = await q.query<{ name: string }>(`select name from users where id=$1`, [w.owner_id]);
    await logEvent(q, {
      squadId: w.squad_id,
      actor: "system",
      type: "plan.created",
      objectType: "plan",
      objectId: plan.id,
      public: { text: `${owner.name}'s whim is happening: ${w.what}`, title: w.what, hostName: owner.name },
    });
    await logEvent(q, {
      userId: w.owner_id,
      squadId: w.squad_id,
      actor: "kitten",
      type: "plan.created",
      objectType: "plan",
      objectId: plan.id,
      payload: { title: w.what, priceSet: (w.price_cents ?? 0) > 0 },
      reason: "enough friends said yes",
    });
    return plan.id;
  });
}

/**
 * What a member sees (FR-PLAN-1/4/5, FR-SEC-10): statuses, pot fill as count + percentage, their OWN
 * limit and paws only. Never anyone else's limit, reason or amount.
 */
export async function planView(planId: string, viewerId: string) {
  const d = await db();
  const p = await getPlan(d, planId);
  const members = await d.query<{ user_id: string; name: string; kitten_name: string | null; status: string }>(
    `select m.user_id, u.name, k.name as kitten_name, m.status from plan_members m join users u on u.id=m.user_id
     left join kittens k on k.user_id=m.user_id where m.plan_id=$1 order by m.joined_at nulls last, u.name`,
    [planId],
  );
  const viewer = members.find((m) => m.user_id === viewerId);
  if (!viewer) {
    const inSquad = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [p.squad_id, viewerId]);
    if (!inSquad.length) throw new Error("You can't see this plan.");
  }
  const [held] = await d.query<{ c: string | null }>(
    `select coalesce(sum(cents),0) as c from paws where plan_id=$1 and status in ('held','captured') and kind <> 'cover'`,
    [planId],
  );
  const invited = members.filter((m) => m.status !== "out").length;
  const inCount = members.filter((m) => m.status === "in").length;
  const target = p.price_mode === "total" ? p.price_cents : p.price_cents * Math.max(inCount, 1);
  const mine = viewer
    ? {
        status: viewer.status,
        ...(await d.query<{ limit_cents: number | null; pawup_need_cents: number | null; overrun_due_cents: number; use_savings: boolean }>(
          `select limit_cents, pawup_need_cents, overrun_due_cents, use_savings from plan_members where plan_id=$1 and user_id=$2`,
          [planId, viewerId],
        ))[0],
        paws: await d.query(`select id, kind, source, cents, status, approve_url, cover_for from paws where plan_id=$1 and user_id=$2 order by created_at`, [planId, viewerId]),
      }
    : null;
  const suggestions = await d.query<{ id: string; candidate: unknown; status: string; round: number }>(
    `select id, candidate, status, round from suggestions where plan_id=$1 order by created_at`,
    [planId],
  );
  const [pounce] = await d.query<{ total_cents: number; group_ids: string[]; shares: Record<string, number> }>(`select total_cents, group_ids, shares from pounces where plan_id=$1 order by created_at desc limit 1`, [planId]);
  const sizes = Array.from(new Set([p.need_at_least, Math.max(inCount, p.need_at_least), invited])).filter((n) => n > 0).sort((a, b) => a - b);

  // What the viewer should expect to pay (owner request): split across max(need at least, people in incl. them).
  let share: { cents: number; splitWays: number; basis: "need" | "in" | "paid"; text: string } | null = null;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  if (pounce?.shares?.[viewerId] != null) {
    share = { cents: pounce.shares[viewerId], splitWays: pounce.group_ids.length, basis: "paid", text: `Your share: ${money(pounce.shares[viewerId])} (paid at the Pounce, ${pounce.group_ids.length} people)` };
  } else if (p.price_cents > 0 && !pounce) {
    const rows = await d.query<{ user_id: string; status: string; weight: number; custom_cents: number | null }>(
      `select user_id, status, weight, custom_cents from plan_members where plan_id=$1 order by joined_at nulls last`,
      [planId],
    );
    const ins = rows.filter((r) => r.status === "in").map((r, i) => ({ id: r.user_id, order: i + 1, weight: r.weight, customCents: r.custom_cents }));
    const me = rows.find((r) => r.user_id === viewerId);
    const viewerIn = me?.status === "in";
    const e = expectedShare(costOf(p), {
      needAtLeast: p.need_at_least,
      inMembers: ins,
      viewer: { id: viewerId, order: ins.find((x) => x.id === viewerId)?.order ?? 0, weight: me?.weight ?? 1, customCents: me?.custom_cents ?? null },
      viewerIn,
    });
    const people = e.basis === "need" ? `${e.splitWays} people (it needs at least ${p.need_at_least})` : `${e.splitWays} people would be in`;
    // Custom and weighted splits aren't "split N ways": say what kind of split it is (owner test, 7 Nov).
    const why =
      p.split_mode === "custom"
        ? `custom split: the host set some amounts, the rest is shared; ${people}`
        : p.split_mode === "weights"
          ? `weighted split; ${people}`
          : e.basis === "need"
            ? `it needs at least ${p.need_at_least}, so it's split ${e.splitWays} ways`
            : `${e.splitWays} people would be in`;
    share = { ...e, text: `Your share${viewerIn ? "" : " if you join"}: ${money(e.cents)} (${why})` };
  }
  return {
    plan: {
      id: p.id,
      title: p.title,
      imageUrl: p.image_url,
      place: p.place,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      priceMode: p.price_mode,
      priceCents: p.price_cents,
      splitMode: p.split_mode,
      needAtLeast: p.need_at_least,
      pounceRule: p.pounce_rule,
      decideBy: p.decide_by,
      refundUntil: p.refund_until,
      status: p.status,
      bookerId: p.booker_id,
      hostId: p.host_id,
      squadId: p.squad_id,
      version: p.version,
    },
    members: members.map((m) => ({ id: m.user_id, name: m.name, kittenName: m.kitten_name, status: m.status })),
    pot: { inCount, invited, filledPct: target > 0 ? Math.min(100, Math.round((Number(held.c ?? 0) / target) * 100)) : 0 },
    ladder: p.price_cents > 0 ? shareLadder(costOf(p), sizes) : [],
    share,
    mine,
    suggestions: suggestions.map((s) => ({ id: s.id, round: s.round, status: s.status, candidate: s.candidate })),
    pounced: pounce ? { groupSize: pounce.group_ids.length, totalCents: pounce.total_cents } : null,
  };
}

export async function respond(userId: string, planId: string, status: "thinking" | "out") {
  const d = await db();
  const p = await getPlan(d, planId);
  if (p.status !== "open") throw new Error("This plan isn't open any more.");
  const inSquad = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [p.squad_id, userId]);
  if (!inSquad.length) throw new Error("You're not in this plan's group.");
  await d.tx(async (q) => {
    await q.query(
      `insert into plan_members (plan_id, user_id, status) values ($1,$2,$3) on conflict (plan_id, user_id) do update set status=excluded.status`,
      [planId, userId, status],
    );
    await logEvent(q, {
      squadId: p.squad_id,
      userId,
      actor: "user",
      actorId: userId,
      type: "plan.responded",
      objectType: "plan",
      objectId: planId,
      payload: { status },
      public: { text: status === "out" ? "can't make it" : "thinking", status, userId },
    });
  });
  if (status === "out") {
    const { releaseMember } = await import("./pounce");
    await releaseMember(planId, userId, "said not this time");
  }
}

const Changes = z
  .object({
    title: z.string().min(1).max(80),
    place: z.string().max(120).nullable(),
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    priceCents: z.number().int().min(0).max(5_000_000),
    priceMode: z.enum(["total", "per_person"]),
    splitMode: z.enum(["equal", "custom", "weights"]),
    needAtLeast: z.number().int().min(1).max(30),
    pounceRule: z.enum(["everyone", "at_least", "host"]),
    decideBy: z.string().datetime(),
    refundUntil: z.string().datetime().nullable(),
    bookerId: z.string().uuid(),
  })
  .partial();

const COLS: Record<string, string> = {
  title: "title",
  place: "place",
  startsAt: "starts_at",
  endsAt: "ends_at",
  priceCents: "price_cents",
  priceMode: "price_mode",
  splitMode: "split_mode",
  needAtLeast: "need_at_least",
  pounceRule: "pounce_rule",
  decideBy: "decide_by",
  refundUntil: "refund_until",
  bookerId: "booker_id",
};

/** Host edits apply directly; members' edits become suggestions the host accepts (FR-NEG-8, FR-WHIM-7). */
export async function editPlan(userId: string, planId: string, raw: unknown): Promise<{ applied: boolean; suggestionId?: string; rechecked: number }> {
  const changes = Changes.parse(raw);
  const d = await db();
  const p = await getPlan(d, planId);
  if (!["open", "on_ice"].includes(p.status)) throw new Error("This plan can't be changed now.");
  if (userId !== p.host_id) {
    const [s] = await d.query<{ id: string }>(`insert into suggestions (plan_id, from_user, round, candidate) values ($1,$2,0,$3) returning id`, [
      planId,
      userId,
      JSON.stringify(changes),
    ]);
    await logEvent(d, { userId: p.host_id, squadId: p.squad_id, actor: "kitten", type: "plan.suggestion", objectType: "plan", objectId: planId, payload: { suggestionId: s.id, changes }, reason: "a friend suggested a change" });
    return { applied: false, suggestionId: s.id, rechecked: 0 };
  }
  const keys = Object.keys(changes).filter((k) => COLS[k]);
  if (!keys.length) return { applied: true, rechecked: 0 };
  await checkEdit(p, changes);
  const sets = keys.map((k, i) => `${COLS[k]} = $${i + 2}`).join(", ");
  // Only while it's still open or on ice: a Pounce or a cancel may have landed since we read it.
  const updated = await d.query(`update plans set ${sets}, version = version + 1, status = case when status='on_ice' then 'open' else status end where id=$1 and status in ('open','on_ice') returning id`, [
    planId,
    ...keys.map((k) => (changes as Record<string, unknown>)[k]),
  ]);
  if (!updated.length) throw new Error("This plan can't be changed now.");
  const rechecked = await recheckAffected(planId, keys);
  await logEvent(d, { squadId: p.squad_id, actor: "user", actorId: userId, type: "plan.edited", objectType: "plan", objectId: planId, public: { text: `The plan changed: ${keys.join(", ")}`, fields: keys } });
  return { applied: true, rechecked };
}

/** Host edits that would break the plan or move money to the wrong place are refused (edge-case pass, 8 Nov). */
async function checkEdit(p: PlanRow, c: z.infer<typeof Changes>) {
  const d = await db();
  const now = Date.now();
  if (c.bookerId && c.bookerId !== p.booker_id) {
    // The booker is paid the whole pot, so it must be someone in this plan's group.
    const ok = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [p.squad_id, c.bookerId]);
    if (!ok.length) throw new Error("The booker has to be someone in this group.");
  }
  const starts = c.startsAt !== undefined ? c.startsAt : p.starts_at;
  const ends = c.endsAt !== undefined ? c.endsAt : p.ends_at;
  if (c.startsAt && Date.parse(c.startsAt) < now) throw new Error("The new start time is in the past.");
  if (starts && ends && Date.parse(ends) <= Date.parse(starts)) throw new Error("The end has to be after the start.");
  if (c.decideBy && Date.parse(c.decideBy) <= now) throw new Error("The deadline has to be in the future.");
  if (p.status === "on_ice" && Date.parse(c.decideBy ?? p.decide_by) <= now) throw new Error("To reopen it, pick a new deadline.");
  if (c.needAtLeast != null) {
    const [{ n }] = await d.query<{ n: number }>(`select count(*)::int as n from memberships where squad_id=$1 and left_at is null`, [p.squad_id]);
    if (c.needAtLeast > n) throw new Error(`Only ${n} people are in this group, so "need at least" can be ${n} at most.`);
  }
  if (c.priceCents === 0 && p.price_cents > 0) {
    const held = await d.query(`select 1 from paws where plan_id=$1 and status in ('held','pending') limit 1`, [p.id]);
    if (held.length) throw new Error("People have already pawed in, so the price can't be removed. Lower it instead, or cancel the plan.");
  }
}

/** After a change, each affected kitten re-checks its owner privately (only time/price changes matter). */
async function recheckAffected(planId: string, keys: string[]): Promise<number> {
  if (!keys.some((k) => ["startsAt", "endsAt", "priceCents", "priceMode"].includes(k))) return 0;
  const d = await db();
  const p = await getPlan(d, planId);
  const [squad] = await d.query<{ name: string }>(`select name from squads where id=$1`, [p.squad_id]);
  const members = await d.query<{ user_id: string }>(`select user_id from plan_members where plan_id=$1 and status in ('thinking','in','invited')`, [planId]);
  const per = p.price_mode === "per_person" ? p.price_cents : Math.ceil(p.price_cents / Math.max(p.need_at_least, 1));
  const checks = await Promise.all(
    members.map(async (m) => {
      const f = await prepareFacts(d, m.user_id, { squadId: p.squad_id, squadName: squad.name, what: p.title, startsAt: p.starts_at, endsAt: p.ends_at, perPersonCents: per || null, excludePlanId: planId });
      const kitten = await getKitten(d, m.user_id);
      return { id: m.user_id, breed: kitten?.breed ?? "tabby", answer: f.answer, facts: f.facts };
    }),
  );
  const lines = await reasonLines(checks);
  for (const c of checks) {
    await logEvent(d, { userId: c.id, squadId: p.squad_id, actor: "kitten", type: "plan.rechecked", objectType: "plan", objectId: planId, payload: { answer: c.answer, reason: lines[c.id] }, reason: "the plan changed" });
  }
  return members.length;
}

export async function acceptSuggestion(hostId: string, suggestionId: string) {
  const d = await db();
  const [s] = await d.query<{ plan_id: string; candidate: Record<string, unknown>; status: string }>(`select plan_id, candidate, status from suggestions where id=$1`, [suggestionId]);
  if (!s) throw new Error("Suggestion not found");
  if (s.status !== "open") throw new Error(s.status === "chosen" ? "That suggestion was already applied." : "That suggestion is closed.");
  const plan = await getPlan(d, s.plan_id);
  if (plan.host_id !== hostId) throw new Error("Only the host can accept suggestions.");
  const res = await editPlan(hostId, s.plan_id, s.candidate);
  if (!res.applied) throw new Error("Only the host can accept suggestions.");
  await d.query(`update suggestions set status='chosen' where id=$1`, [suggestionId]);
  return res;
}

/**
 * Kittens look for a version that fits everyone interested (PRD §B7 rounds, FR-NEG-5/6/7):
 * each kitten may suggest one alternative per round; the referee scores; it always stops after 2 rounds.
 */
export async function negotiate(planId: string) {
  const d = await db();
  const p = await getPlan(d, planId);
  const base = windowOf(p.starts_at, p.ends_at);
  if (!base) return { rounds: 0, fitsAll: true, note: "no date to negotiate yet" };
  const members = await d.query<{ user_id: string; limit_cents: number | null }>(
    `select user_id, limit_cents from plan_members where plan_id=$1 and status in ('thinking','in')`,
    [planId],
  );
  const voters: Voter[] = [];
  for (const m of members) {
    const cal = await calendar(d, m.user_id, planId);
    voters.push({ id: m.user_id, limitCents: null, plansIn: cal.plansIn, busy: cal.busy });
  }
  const len = base.end.getTime() - base.start.getTime();
  const keyOf = (s: Date) => s.toISOString();
  const options: Option[] = [{ key: keyOf(base.start), window: base, perPersonCents: null }];
  const seen = [keyOf(base.start)];
  let best = pickOption(options, voters).best!;
  let rounds = 0;
  for (let round = 1; round <= 2; round++) {
    if (best.fits.length === voters.length) break;
    rounds = round;
    const suggestedBy: string[] = [];
    const current = options.find((o) => o.key === best.key)!;
    for (const v of voters.filter((x) => !best.fits.includes(x.id))) {
      for (let wk = 1; wk <= 6; wk++) {
        const start = new Date(current.window!.start.getTime() + wk * 7 * 86400_000);
        const w = { start, end: new Date(start.getTime() + len) };
        const ok = guard({ round, fromUser: v.id, key: keyOf(start), alreadyThisRound: suggestedBy, seenKeys: seen });
        if (!ok.ok) continue;
        if (clash(w, v.plansIn, []).hard) continue;
        options.push({ key: keyOf(start), window: w, perPersonCents: null });
        seen.push(keyOf(start));
        suggestedBy.push(v.id);
        await d.query(`insert into suggestions (plan_id, from_user, round, candidate) values ($1,$2,$3,$4)`, [
          planId,
          v.id,
          round,
          JSON.stringify({ startsAt: w.start.toISOString(), endsAt: w.end.toISOString() }),
        ]);
        break;
      }
    }
    best = pickOption(options, voters).best!;
  }
  const fitsAll = best.fits.length === voters.length;
  const chosen = options.find((o) => o.key === best.key)!;
  const changed = best.key !== keyOf(base.start);
  if (changed) {
    const [s] = await d.query<{ id: string }>(`insert into suggestions (plan_id, from_user, round, candidate, status) values ($1,null,$2,$3,'open') returning id`, [
      planId,
      rounds,
      JSON.stringify({ startsAt: chosen.window!.start.toISOString(), endsAt: chosen.window!.end.toISOString() }),
    ]);
    await logEvent(d, {
      userId: p.host_id,
      squadId: p.squad_id,
      actor: "kitten",
      type: "plan.negotiated",
      objectType: "plan",
      objectId: planId,
      payload: { suggestionId: s.id, startsAt: chosen.window!.start, fits: best.fits.length, of: voters.length, text: `${chosen.window!.start.toDateString()} fits ${best.fits.length} of ${voters.length}. Apply it?` },
      reason: "kittens looked for a date that fits everyone",
    });
  }
  for (const v of voters.filter((x) => !best.fits.includes(x.id))) {
    await logEvent(d, {
      userId: v.id,
      squadId: p.squad_id,
      actor: "kitten",
      type: "plan.no_fit",
      objectType: "plan",
      objectId: planId,
      payload: { text: `We couldn't find a date that works for you. Best option fits ${best.fits.length} of ${voters.length}. Change something, or skip?` },
      reason: "negotiation stopped after 2 rounds",
    });
  }
  return { rounds, fitsAll, fits: best.fits.length, of: voters.length, chosenStartsAt: chosen.window?.start.toISOString() ?? null, changed };
}

/**
 * The host sets how the cost is split (FR-PLAN-3): equal, custom amounts ("Priya pays $200, the rest split") or
 * weights (a couple counts as 2). Each person still only ever sees their own share.
 */
export async function setSplit(
  hostId: string,
  planId: string,
  input: { splitMode: "equal" | "custom" | "weights"; members?: { userId: string; customCents?: number | null; weight?: number }[] },
) {
  const d = await db();
  const p = await getPlan(d, planId);
  if (p.host_id !== hostId) throw new Error("Only the host changes the split.");
  if (p.status !== "open") throw new Error("The split can't change after the Pounce.");
  const members = input.members ?? [];
  for (const m of members) {
    const ok = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [p.squad_id, m.userId]);
    if (!ok.length) throw new Error("That person isn't in this plan's group.");
    if (m.weight != null && (!Number.isInteger(m.weight) || m.weight < 1 || m.weight > 10)) throw new Error("Weights are whole numbers from 1 to 10.");
    if (m.customCents != null && (!Number.isInteger(m.customCents) || m.customCents < 0)) throw new Error("Pick an amount.");
  }
  await d.tx(async (q) => {
    await q.query(`update plans set split_mode=$2 where id=$1`, [planId, input.splitMode]);
    for (const m of members) {
      await q.query(
        `insert into plan_members (plan_id, user_id, status, weight, custom_cents) values ($1,$2,'invited',coalesce($3,1),$4)
         on conflict (plan_id, user_id) do update set weight=coalesce($3, plan_members.weight), custom_cents=$4`,
        [planId, m.userId, m.weight ?? null, input.splitMode === "custom" ? (m.customCents ?? null) : null],
      );
    }
    if (input.splitMode === "custom" && p.price_mode === "total") {
      const [{ c }] = await q.query<{ c: string }>(`select coalesce(sum(custom_cents),0) as c from plan_members where plan_id=$1 and status <> 'out'`, [planId]);
      if (Number(c) > p.price_cents) throw new Error("The custom amounts add up to more than the price.");
    }
    await logEvent(q, { squadId: p.squad_id, actor: "user", actorId: hostId, type: "plan.split", objectType: "plan", objectId: planId, public: { text: `The host changed how ${p.title} is split (${input.splitMode}).` } });
  });
  return { ok: true, splitMode: input.splitMode };
}
