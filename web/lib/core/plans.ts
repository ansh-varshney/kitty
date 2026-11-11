import { z } from "zod";
import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { getKitten } from "./users";
import { prepareFacts } from "./whims";
import { giveBack } from "./set-aside";

const fmtUsd = (c: number) => `$${(c / 100).toFixed(2)}`;
import { expectedShare, shareLadder, type CostModel } from "../referee/shares";
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
  use_savings: boolean;
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
  up_to_cents?: number | null;
  price_mode?: string | null;
  pounce_rule?: string | null;
  decide_by?: string | null;
  booker_id?: string | null;
  use_savings?: boolean;
}): Promise<string> {
  const d = await db();
  const created = await d.tx(async (q) => {
    const flipped = await q.query(`update whims set status='plan' where id=$1 and status='floating' returning id`, [w.id]);
    if (!flipped.length) return "";
    // The whim's deadline carries straight over: everyone has to be paid in by the time set when it was floated.
    const decideBy = new Date(w.decide_by && new Date(w.decide_by).getTime() > Date.now() ? w.decide_by : Date.now() + 48 * 3600_000);
    const priceMode = w.price_mode ?? (w.price_cents == null && w.up_to_cents != null ? "per_person" : "total");
    const [plan] = await q.query<{ id: string }>(
      `insert into plans (whim_id, squad_id, host_id, booker_id, title, image_url, place, starts_at, ends_at, price_cents, price_mode, need_at_least, pounce_rule, decide_by, use_savings)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'host',$13,$14) returning id`,
      [w.id, w.squad_id, w.owner_id, w.booker_id ?? w.owner_id, w.what, w.image_url, w.place, w.starts_at, w.ends_at, w.price_cents ?? w.up_to_cents ?? 0, priceMode, w.need_at_least, decideBy.toISOString(), Boolean(w.use_savings)],
    );
    const answers = await q.query<{ user_id: string; confirmed: string | null }>(
      `select a.user_id, a.confirmed from answers a join memberships m on m.squad_id=$2 and m.user_id=a.user_id and m.left_at is null where a.whim_id=$1`,
      [w.id, w.squad_id],
    );
    // The host is always in (owner, 9 Nov; FR-PLAN-8). Their money is set aside separately, and the Pounce waits for it.
    await q.query(`insert into plan_members (plan_id, user_id, status, joined_at) values ($1,$2,'in',now())`, [plan.id, w.owner_id]);
    // A yes on the whim is a yes to paying: their kitten chips in as soon as the plan exists. Everyone else can tag along.
    for (const a of answers) {
      const status = a.confirmed === "yes" ? "in" : a.confirmed === "no" ? "out" : "invited";
      await q.query(`insert into plan_members (plan_id, user_id, status, joined_at) values ($1,$2,$3,$4) on conflict do nothing`, [plan.id, a.user_id, status, status === "in" ? new Date().toISOString() : null]);
    }
    // Everyone in already set their share aside when they agreed (FR-JAR-8): it becomes their money in the plan,
    // exactly their share. Anything over it (more people said yes than needed) goes straight back.
    const ins = new Set([w.owner_id, ...answers.filter((a) => a.confirmed === "yes").map((a) => a.user_id)]);
    const { sharesFor } = await import("./pounce");
    const shares = await sharesFor(q, plan.id);
    const holds = await q.query<{ user_id: string; jar_cents: number; savings_cents: number }>(`update whim_holds set status='used' where whim_id=$1 and status='held' returning user_id, jar_cents, savings_cents`, [w.id]);
    for (const h of holds) {
      if (!ins.has(h.user_id)) {
        await giveBack(q, h.user_id, { jarCents: h.jar_cents, savingsCents: h.savings_cents }, w.squad_id, "you're not in this plan");
        continue;
      }
      const share = shares[h.user_id] ?? 0;
      const fromSavings = Math.min(h.savings_cents, share);
      const fromJar = Math.min(h.jar_cents, share - fromSavings);
      const back = { jarCents: h.jar_cents - fromJar, savingsCents: h.savings_cents - fromSavings };
      if (fromJar > 0) await q.query(`insert into paws (plan_id, user_id, kind, source, cents, status) values ($1,$2,'initial','jar',$3,'held')`, [plan.id, h.user_id, fromJar]);
      if (fromSavings > 0) await q.query(`insert into paws (plan_id, user_id, kind, source, cents, status) values ($1,$2,'initial','savings',$3,'held')`, [plan.id, h.user_id, fromSavings]);
      await giveBack(q, h.user_id, back, w.squad_id, "your share came down");
      const extra = back.jarCents + back.savingsCents;
      await logEvent(q, {
        userId: h.user_id,
        squadId: w.squad_id,
        actor: "kitten",
        type: "paw.placed",
        objectType: "plan",
        objectId: plan.id,
        payload: { cents: fromJar + fromSavings, text: `"${w.what}" is happening. Your ${fmtUsd(fromJar + fromSavings)} share is in, from what you set aside.${extra > 0 ? ` ${fmtUsd(extra)} went back to your Treat Jar, since more people said yes.` : ""}` },
        reason: "enough friends said yes",
      });
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
      payload: { title: w.what, priceSet: (w.price_cents ?? w.up_to_cents ?? 0) > 0 },
      reason: "enough friends said yes",
    });
    return plan.id;
  });
  if (created) {
    const { syncShares } = await import("./pounce");
    await syncShares(created).catch((e) => console.error(`[plans] collecting shares: ${(e as Error).message}`));
  }
  return created;
}

/**
 * What a member sees (FR-PLAN-1/4/5, FR-SEC-10): statuses, pot fill as count + percentage, their OWN
 * limit and paws only. Never anyone else's limit, reason or amount.
 */
export async function planView(planId: string, viewerId: string) {
  const d = await db();
  const p = await getPlan(d, planId);
  const members = await d.query<{ user_id: string; name: string; kitten_name: string | null; kitten_look: Record<string, unknown> | null; status: string }>(
    `select m.user_id, u.name, k.name as kitten_name, k.look as kitten_look, m.status from plan_members m join users u on u.id=m.user_id
     left join kittens k on k.user_id=m.user_id where m.plan_id=$1 order by m.joined_at nulls last, u.name`,
    [planId],
  );
  const viewer = members.find((m) => m.user_id === viewerId);
  const [place] = await d.query<{ kind: string }>(`select kind from squads where id=$1`, [p.squad_id]);
  const withFriend = place?.kind === "direct" ? (members.find((m) => m.user_id !== viewerId)?.user_id ?? null) : null;
  if (!viewer) {
    const inSquad = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [p.squad_id, viewerId]);
    if (!inSquad.length) throw new Error("You can't see this plan.");
  }
  const [held] = await d.query<{ c: string | null }>(
    `select coalesce(sum(cents),0) as c from paws where plan_id=$1 and status in ('held','captured') and kind <> 'cover'`,
    [planId],
  );
  const invited = members.filter((m) => m.status !== "out").length;
  const inCount = members.filter((m) => m.status === "in").length; // includes the host, who is always in (FR-PLAN-8)
  const target = p.price_mode === "total" ? p.price_cents : p.price_cents * Math.max(inCount, 1);
  const mine = viewer
    ? {
        status: viewer.status,
        ...(await d.query<{ limit_cents: number | null; pawup_need_cents: number | null; overrun_due_cents: number; overrun_paid: boolean; use_savings: boolean }>(
          `select limit_cents, pawup_need_cents, overrun_due_cents, overrun_paid, use_savings from plan_members where plan_id=$1 and user_id=$2`,
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
  const { moneyState, tagView } = await import("./pounce");
  const cash = await moneyState(d, p);
  const tag = await tagView(d, p, viewerId);
  const { bookingState } = await import("./jar");
  const booking = await bookingState(d, planId);
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
  // The squad sees "receipt pending" once the booker has been reminded (§B10), never who.
  const receiptChased =
    p.status === "pounced"
      ? await d.query(`select 1 from reminders r where r.kind='receipt' and r.object_id=$1 and not exists (select 1 from receipts x where x.plan_id=$1 and x.status='confirmed') limit 1`, [planId])
      : [];
  return {
    receiptPending: receiptChased.length > 0,
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
      withFriend,
      version: p.version,
      whimId: p.whim_id,
      useSavings: p.use_savings,
      bookerName: members.find((m) => m.user_id === p.booker_id)?.name ?? null,
    },
    members: members.map((m) => ({ id: m.user_id, name: m.name, kittenName: m.kitten_name, look: m.kitten_look, status: m.status })),
    pot: { inCount, invited, filledPct: target > 0 ? Math.min(100, Math.round((Number(held.c ?? 0) / target) * 100)) : 0, collectedCents: cash.collectedCents, targetCents: cash.targetCents, allPaid: cash.allPaid },
    canPounce: p.status === "open" && inCount >= p.need_at_least && cash.allPaid,
    myShareCents: cash.shares[viewerId] ?? null,
    myHeldCents: cash.held[viewerId] ?? 0,
    ladder: p.price_cents > 0 ? shareLadder(costOf(p), sizes) : [],
    share,
    mine,
    suggestions: suggestions.map((s) => ({ id: s.id, round: s.round, status: s.status, candidate: s.candidate })),
    pounced: pounce ? { groupSize: pounce.group_ids.length, totalCents: pounce.total_cents } : null,
    tag,
    booking,
  };
}

export async function respond(userId: string, planId: string, status: "thinking" | "out") {
  const d = await db();
  const p = await getPlan(d, planId);
  if (p.status !== "open") throw new Error("This plan isn't open any more.");
  if (p.host_id === userId) throw new Error("You're the host, so you're in. To call it off, cancel the plan.");
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
    const { releaseMember, syncShares } = await import("./pounce");
    await releaseMember(planId, userId, "said not this time");
    await syncShares(planId);
  }
}

const FIELD_WORDS: Record<string, string> = { title: "the name", place: "the place", startsAt: "the time", endsAt: "the end time", priceCents: "the price", priceMode: "how the price works", splitMode: "the split", needAtLeast: "how many people it needs", pounceRule: "when it Pounces", decideBy: "the deadline", refundUntil: "the refund date", bookerId: "who's booking" };

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

/** Only a host re-opening a plan that went on ice edits one: a plan doesn't change once it's made (FR-PLAN-9). */
export async function editPlan(userId: string, planId: string, raw: unknown): Promise<{ applied: boolean; rechecked: number }> {
  const changes = Changes.parse(raw);
  const d = await db();
  const p = await getPlan(d, planId);
  if (!["open", "on_ice"].includes(p.status)) throw new Error("This plan can't be changed now.");
  if (userId !== p.host_id) throw new Error("Only the host can do that.");
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
  if (p.status === "on_ice") {
    // Re-opened: the kittens collect everyone's share again.
    const { syncShares } = await import("./pounce");
    await syncShares(planId);
  }
  await logEvent(d, { squadId: p.squad_id, actor: "user", actorId: userId, type: "plan.edited", objectType: "plan", objectId: planId, public: { text: `The plan changed: ${keys.map((k) => FIELD_WORDS[k] ?? k).join(", ")}.`, fields: keys } });
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
