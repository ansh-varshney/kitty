import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { calendar, committedCents, jarBalances, monthSpentCents, savingsBalance, windowOf } from "./month";
import { getKitten, getUser, listRules } from "./users";
import { costOf, getPlan, type PlanRow } from "./plans";
import { decide, funBudgetCents } from "../referee/rules";
import { checkGroup, ruleAllowsPounce, solveGroup, type Candidate } from "../referee/pounce";
import { leftovers, tagAlong as tagAlongMath, type Paid } from "../referee/settle";
import { clash } from "../referee/time";
import { authorizeHold, captureHold, createTestCardHold, createWalletHold, refundCapture, testCardPayment, voidHold } from "../paypal/holds";
import { sendPayout } from "../paypal/payouts";
import { baseUrl } from "../env";

/** Paw in, paw-up, cover, Pounce, release, tag along (PRD §B9, FR-POUNCE-1..10, FR-CAL-2, FR-MONTH-2). */

type Paw = {
  id: string;
  plan_id: string;
  user_id: string;
  kind: "initial" | "paw_up" | "cover" | "tag_along";
  source: "savings" | "jar" | "paypal";
  cents: number;
  cover_for: string | null;
  order_id: string | null;
  authorization_id: string | null;
  status: string;
  captured_cents: number;
  capture_id: string | null;
};

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const SOURCE_ORDER = { savings: 0, jar: 1, paypal: 2 } as const;

async function kittenName(q: Queryable, userId: string) {
  return (await getKitten(q, userId))?.name ?? "A kitten";
}

/** Place a hold of `cents` for a user: Treat Jar if the rules allow it alone, else PayPal. */
async function placeHold(
  plan: PlanRow,
  userId: string,
  cents: number,
  kind: Paw["kind"],
  coverFor: string | null = null,
): Promise<{ pawId: string; source: "jar" | "paypal"; approveUrl?: string; reason: string }> {
  const d = await db();
  const user = await getUser(d, userId);
  if (!user) throw new Error("Unknown user");
  const rules = await listRules(d, userId);
  const jar = await jarBalances(d, userId);
  const dec = decide(
    { kind: kind === "cover" ? "cover" : kind === "paw_up" ? "paw_up" : "paw_in", cents, source: "jar", squadId: plan.squad_id },
    { rules: rules.filter((r) => r.type !== "R1"), jarAvailableCents: jar.availableCents, monthSpentCents: 0, monthCommittedCents: 0 },
  );
  if (dec.mode === "auto") {
    const pawId = await d.tx(async (q) => {
      await move(q, acct.jar(userId), acct.jarHeld(userId), cents, { kind: "jar_reserve", userId, planId: plan.id, reason: `${kind} from Treat Jar` });
      const [paw] = await q.query<{ id: string }>(
        `insert into paws (plan_id, user_id, kind, source, cents, cover_for, status) values ($1,$2,$3,'jar',$4,$5,'held') returning id`,
        [plan.id, userId, kind, cents, coverFor],
      );
      return paw.id;
    });
    return { pawId, source: "jar", reason: "within your free hand, from your Treat Jar" };
  }
  if (user.is_demo) {
    const hold = await createTestCardHold({ cents, referenceId: plan.id, customId: `${kind}:${userId.slice(0, 8)}` });
    const [paw] = await d.query<{ id: string }>(
      `insert into paws (plan_id, user_id, kind, source, cents, cover_for, order_id, authorization_id, status, expires_at)
       values ($1,$2,$3,'paypal',$4,$5,$6,$7,'held',$8) returning id`,
      [plan.id, userId, kind, cents, coverFor, hold.orderId, hold.authorizationId, hold.expiresAt ?? null],
    );
    return { pawId: paw.id, source: "paypal", reason: "PayPal hold (demo friend, sandbox test card)" };
  }
  const [paw] = await d.query<{ id: string }>(
    `insert into paws (plan_id, user_id, kind, source, cents, cover_for, status) values ($1,$2,$3,'paypal',$4,$5,'pending') returning id`,
    [plan.id, userId, kind, cents, coverFor],
  );
  const base = baseUrl();
  const { orderId, approveUrl } = await createWalletHold({
    cents,
    referenceId: plan.id,
    customId: `paw:${paw.id}`,
    description: `Kitty: ${plan.title} (hold, not a charge)`,
    returnUrl: `${base}/api/v1/return/hold`,
    cancelUrl: `${base}/?cancelled=hold`,
  });
  await d.query(`update paws set order_id=$2, approve_url=$3 where id=$1`, [paw.id, orderId, approveUrl]);
  return { pawId: paw.id, source: "paypal", approveUrl, reason: "needs your PayPal approval" };
}

export type PawInResult =
  | { ok: true; deferred?: boolean; savingsCents: number; jarCents: number; paypalCents: number; approveUrl?: string; pounce?: unknown }
  | { ok: false; code: "clash"; withPlan: string }
  | { ok: false; code: "over_budget"; overByCents: number };

/** Paw in "up to $X" (FR-POUNCE-1): own savings first, then Treat Jar (free hand), then a PayPal hold. */
export async function pawIn(
  userId: string,
  planId: string,
  opts: { limitCents: number; useSavings?: boolean; confirmOverBudget?: boolean; confirmBusy?: boolean },
): Promise<PawInResult> {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "open") throw new Error("This plan isn't open.");
  if (plan.price_cents <= 0) throw new Error("The host hasn't set a price yet.");
  const limit = opts.limitCents;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("Pick an amount.");
  const existing = await d.query(`select 1 from paws where plan_id=$1 and user_id=$2 and kind='initial' and status in ('pending','held')`, [planId, userId]);
  if (existing.length) throw new Error("You're already in. Use paw up to raise your limit.");
  const inSquad = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [plan.squad_id, userId]);
  if (!inSquad.length) throw new Error("You're not in this squad.");

  // No double booking (FR-CAL-2/3)
  const cal = await calendar(d, userId, planId);
  const c = clash(windowOf(plan.starts_at, plan.ends_at), cal.plansIn, cal.busy);
  if (c.hard) return { ok: false, code: "clash", withPlan: cal.plansIn.find((p) => p.planId === c.hard!.planId)?.title ?? "another plan" };

  // Overspending guard (FR-MONTH-2)
  const rules = await listRules(d, userId);
  const budget = funBudgetCents(rules);
  if (budget != null && !opts.confirmOverBudget) {
    const after = (await monthSpentCents(d, userId)) + (await committedCents(d, userId, planId)) + limit;
    if (after > budget) return { ok: false, code: "over_budget", overByCents: after - budget };
  }

  await d.query(
    `insert into plan_members (plan_id, user_id, status) values ($1,$2,'thinking') on conflict (plan_id, user_id) do nothing`,
    [planId, userId],
  );
  const useSavings = opts.useSavings ?? true;
  await d.query(`update plan_members set limit_cents=$3, use_savings=$4, joined_at=coalesce(joined_at, now()) where plan_id=$1 and user_id=$2`, [
    planId,
    userId,
    limit,
    useSavings,
  ]);

  // Holds are placed only in the last 72 h before the deadline (FR-POUNCE-10).
  if (new Date(plan.decide_by).getTime() - Date.now() > 72 * 3600_000) {
    await d.query(`update plan_members set status='in' where plan_id=$1 and user_id=$2`, [planId, userId]);
    await logEvent(d, { userId, squadId: plan.squad_id, actor: "kitten", type: "paw.deferred", objectType: "plan", objectId: planId, payload: { limitCents: limit }, reason: "the deadline is more than 3 days away; I'll place the hold later" });
    await publicIn(d, plan, userId);
    return { ok: true, deferred: true, savingsCents: 0, jarCents: 0, paypalCents: 0 };
  }

  return placeForLimit(plan, userId, limit, useSavings, c.soft?.label ?? null);
}

async function publicIn(q: Queryable, plan: PlanRow, userId: string) {
  await logEvent(q, {
    squadId: plan.squad_id,
    actor: "kitten",
    actorId: userId,
    type: "paw.in",
    objectType: "plan",
    objectId: plan.id,
    public: { text: `${await kittenName(q, userId)}: in, with a budget condition`, userId },
  });
}

async function placeForLimit(plan: PlanRow, userId: string, limit: number, useSavings: boolean, softBusy: string | null): Promise<PawInResult> {
  const d = await db();
  let savingsCents = 0;
  if (useSavings) {
    const bal = await savingsBalance(d, plan.squad_id, userId);
    savingsCents = Math.min(bal, limit);
    if (savingsCents > 0) {
      await d.tx(async (q) => {
        await move(q, acct.savings(plan.squad_id, userId), acct.savingsHeld(plan.squad_id, userId), savingsCents, { kind: "savings_reserve", userId, planId: plan.id, reason: "your Kitty Party savings pay first" });
        await q.query(`insert into paws (plan_id, user_id, kind, source, cents, status) values ($1,$2,'initial','savings',$3,'held')`, [plan.id, userId, savingsCents]);
      });
    }
  }
  const rest = limit - savingsCents;
  let jarCents = 0;
  let paypalCents = 0;
  let approveUrl: string | undefined;
  let reason = "";
  if (rest > 0) {
    const h = await placeHold(plan, userId, rest, "initial");
    if (h.source === "jar") jarCents = rest;
    else paypalCents = rest;
    approveUrl = h.approveUrl;
    reason = h.reason;
  }
  const pending = Boolean(approveUrl);
  await d.query(`update plan_members set status=$3 where plan_id=$1 and user_id=$2`, [plan.id, userId, pending ? "thinking" : "in"]);
  await logEvent(d, {
    userId,
    squadId: plan.squad_id,
    actor: "kitten",
    actorId: userId,
    type: "paw.placed",
    objectType: "plan",
    objectId: plan.id,
    payload: { limitCents: limit, savingsCents, jarCents, paypalCents, pending, softBusy, text: `Paw in up to ${fmt(limit)}: ${fmt(savingsCents)} savings, ${fmt(jarCents)} Treat Jar, ${fmt(paypalCents)} PayPal hold` },
    reason: reason || "covered by your savings",
    paypalId: (await d.query<{ authorization_id: string | null }>(`select authorization_id from paws where plan_id=$1 and user_id=$2 and authorization_id is not null order by created_at desc limit 1`, [plan.id, userId]))[0]?.authorization_id ?? null,
  });
  if (!pending) await publicIn(d, plan, userId);
  const pounce = pending ? undefined : await tryPounce(plan.id, {});
  return { ok: true, savingsCents, jarCents, paypalCents, approveUrl, pounce };
}

/** Back from PayPal after approving a hold. */
export async function finishWalletHold(orderId: string) {
  const d = await db();
  const [paw] = await d.query<Paw>(`select * from paws where order_id=$1`, [orderId]);
  if (!paw) throw new Error("Unknown hold");
  if (paw.status === "held") return { planId: paw.plan_id, already: true };
  const hold = await authorizeHold(orderId);
  await d.query(`update paws set status='held', authorization_id=$2, expires_at=$3 where id=$1`, [paw.id, hold.authorizationId, hold.expiresAt ?? null]);
  const plan = await getPlan(d, paw.plan_id);
  await logEvent(d, { userId: paw.user_id, squadId: plan.squad_id, actor: "user", actorId: paw.user_id, type: "paw.approved", objectType: "plan", objectId: plan.id, payload: { cents: paw.cents, kind: paw.kind }, paypalId: hold.authorizationId });
  const stillPending = await d.query(`select 1 from paws where plan_id=$1 and user_id=$2 and status='pending'`, [paw.plan_id, paw.user_id]);
  if (!stillPending.length && paw.kind === "initial") {
    await d.query(`update plan_members set status='in' where plan_id=$1 and user_id=$2`, [paw.plan_id, paw.user_id]);
    await publicIn(d, plan, paw.user_id);
  }
  await tryPounce(paw.plan_id, {});
  return { planId: paw.plan_id };
}

/** The private paw-up answer (FR-POUNCE-4): yes = an extra hold for the gap; no = out of this Pounce. */
export async function answerPawUp(userId: string, planId: string, accept: boolean) {
  const d = await db();
  const plan = await getPlan(d, planId);
  const [m] = await d.query<{ pawup_need_cents: number | null; limit_cents: number | null }>(
    `select pawup_need_cents, limit_cents from plan_members where plan_id=$1 and user_id=$2`,
    [planId, userId],
  );
  if (!m?.pawup_need_cents) throw new Error("No paw-up waiting.");
  if (!accept) {
    await releaseMember(planId, userId, "you chose not to paw up");
  } else {
    const h = await placeHold(plan, userId, m.pawup_need_cents, "paw_up");
    await d.query(`update plan_members set limit_cents=coalesce(limit_cents,0)+$3, pawup_need_cents=null where plan_id=$1 and user_id=$2`, [planId, userId, m.pawup_need_cents]);
    await logEvent(d, { userId, squadId: plan.squad_id, actor: "user", actorId: userId, type: "paw.up", objectType: "plan", objectId: planId, payload: { cents: m.pawup_need_cents, source: h.source, approveUrl: h.approveUrl }, reason: h.reason });
    if (h.approveUrl) return { ok: true, approveUrl: h.approveUrl };
  }
  return { ok: true, pounce: await tryPounce(planId, {}) };
}

/** Cover part of a friend's share, funded up front by the coverer, anonymous by default (FR-POUNCE-5). */
export async function coverFriend(fromId: string, planId: string, toId: string, cents: number) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (fromId === toId) throw new Error("You can't cover yourself.");
  const h = await placeHold(plan, fromId, cents, "cover", toId);
  await d.query(`update plan_members set pawup_need_cents = greatest(coalesce(pawup_need_cents,0) - $3, 0) where plan_id=$1 and user_id=$2`, [planId, toId, cents]);
  await d.query(`update plan_members set pawup_need_cents = null where plan_id=$1 and user_id=$2 and pawup_need_cents = 0`, [planId, toId]);
  await logEvent(d, { userId: fromId, squadId: plan.squad_id, actor: "user", actorId: fromId, type: "paw.cover", objectType: "plan", objectId: planId, payload: { cents, forUser: toId, source: h.source }, reason: "you chose to cover a friend" });
  await logEvent(d, { squadId: plan.squad_id, actor: "system", type: "paw.cover", objectType: "plan", objectId: planId, public: { text: "Someone quietly covered part of a friend's share." } });
  if (h.approveUrl) return { ok: true, approveUrl: h.approveUrl };
  return { ok: true, pounce: await tryPounce(planId, {}) };
}

async function candidatesFor(q: Queryable, plan: PlanRow): Promise<Candidate[]> {
  const rows = await q.query<{ user_id: string; joined_at: string | null; weight: number; custom_cents: number | null }>(
    `select user_id, joined_at, weight, custom_cents from plan_members where plan_id=$1 and status='in' order by joined_at nulls last`,
    [plan.id],
  );
  const paws = await q.query<Paw>(`select * from paws where plan_id=$1 and status='held'`, [plan.id]);
  return rows.map((r, i) => ({
    id: r.user_id,
    order: i + 1,
    weight: r.weight,
    customCents: r.custom_cents,
    limitCents: paws.filter((p) => p.user_id === r.user_id && p.kind !== "cover").reduce((a, p) => a + p.cents, 0),
    coverCents: paws.filter((p) => p.kind === "cover" && p.cover_for === r.user_id).reduce((a, p) => a + p.cents, 0),
  }));
}

/**
 * Try to Pounce (FR-POUNCE-2/3/4/7). Paw-up rounds (max 2) come first; then the final group is solved;
 * if nobody fits enough, everything is released and the plan goes on ice.
 */
export async function tryPounce(planId: string, opts: { hostTapped?: boolean; atDeadline?: boolean; finalize?: boolean }) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "open") return { status: plan.status };
  const members = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1`, [planId]);
  const invited = members.filter((m) => m.status !== "out").length;
  const cands = await candidatesFor(d, plan);
  const allowed = ruleAllowsPounce({
    rule: plan.pounce_rule,
    invited,
    inCount: cands.length,
    needAtLeast: plan.need_at_least,
    atDeadline: Boolean(opts.atDeadline),
    hostTapped: Boolean(opts.hostTapped),
  });
  if (!allowed) {
    if (opts.atDeadline) return putOnIce(planId, "the deadline passed without enough people in");
    return { status: "waiting", inCount: cands.length, invited };
  }
  const cost = costOf(plan);
  const short = checkGroup(cost, cands).short;
  const windowOpen = plan.pawup_until && new Date(plan.pawup_until) > new Date();
  if (short.length && plan.paw_up_round < 2 && !opts.finalize && !opts.atDeadline && !windowOpen) {
    const round = plan.paw_up_round + 1;
    const until = new Date(Math.min(Date.now() + 15 * 60_000, new Date(plan.decide_by).getTime()));
    await d.tx(async (q) => {
      await q.query(`update plans set paw_up_round=$2, pawup_until=$3 where id=$1`, [planId, round, until.toISOString()]);
      for (const s of short) {
        await q.query(`update plan_members set pawup_need_cents=$3 where plan_id=$1 and user_id=$2`, [planId, s.id, s.needCents]);
        await logEvent(q, {
          userId: s.id,
          squadId: plan.squad_id,
          actor: "kitten",
          type: "pawup.asked",
          objectType: "plan",
          objectId: planId,
          payload: { needCents: s.needCents, text: `The share went up. Paw up ${fmt(s.needCents)} to stay in?` },
          reason: `round ${round} of 2`,
        });
      }
      await logEvent(q, {
        userId: plan.host_id,
        squadId: plan.squad_id,
        actor: "kitten",
        type: "pawup.round",
        objectType: "plan",
        objectId: planId,
        payload: { round, shortCount: short.length, text: `${short.length} person's budget is below the share. I asked privately (round ${round} of 2).` },
      });
    });
    return { status: "waiting_paw_up", round, shortCount: short.length };
  }
  if (short.length && windowOpen && !opts.finalize && !opts.atDeadline) return { status: "waiting_paw_up", round: plan.paw_up_round, shortCount: short.length };

  const sol = solveGroup(cost, cands, plan.need_at_least);
  if (!sol.feasible) return putOnIce(planId, sol.reason === "too_few" ? "not enough people fit the share" : "nobody fits the share");
  for (const id of sol.removed) await releaseMember(planId, id, "the share went above your limit");
  return executePounce(plan, sol.groupIds, sol.shares);
}

async function executePounce(plan: PlanRow, groupIds: string[], shares: Record<string, number>) {
  const d = await db();
  const locked = await d.query(`update plans set status='pouncing' where id=$1 and status='open' returning id`, [plan.id]);
  if (!locked.length) return { status: "already_pouncing" };
  const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and status='held'`, [plan.id]);
  type Use = { paw: Paw; take: number; captureId?: string };
  const uses: Use[] = [];
  for (const uid of groupIds) {
    let need = shares[uid];
    const own = paws
      .filter((p) => p.user_id === uid && p.kind !== "cover")
      .sort((a, b) => SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || (a.kind === "initial" ? -1 : 1));
    const covers = paws.filter((p) => p.kind === "cover" && p.cover_for === uid);
    for (const p of [...own, ...covers]) {
      const take = Math.min(need, p.cents);
      need -= take;
      uses.push({ paw: p, take });
    }
    if (need > 0) {
      await d.query(`update plans set status='open' where id=$1`, [plan.id]);
      throw new Error("Internal: a member's paws don't cover their share");
    }
  }
  const used = new Set(uses.map((u) => u.paw.id));
  const unused = paws.filter((p) => !used.has(p.id));

  // 1) PayPal captures, all at once (the Pounce moment should feel instant). If ANY fails, nothing is kept:
  //    refund what went through, release those members (their holds were final captures, so they can't be
  //    reused), reopen the plan and ask them to paw in again.
  const toCapture = uses.filter((x) => x.paw.source === "paypal" && x.take > 0);
  const results = await Promise.allSettled(toCapture.map((u) => captureHold(u.paw.authorization_id!, u.take, true)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") toCapture[i].captureId = r.value.captureId;
  });
  const failed = toCapture.filter((_, i) => results[i].status === "rejected");
  if (failed.length) {
    const ok = toCapture.filter((_, i) => results[i].status === "fulfilled");
    const refunded = await Promise.allSettled(ok.map((c) => refundCapture(c.captureId!, c.take)));
    for (const [i, c] of ok.entries()) {
      await d.query(`update paws set status='voided', capture_id=$2 where id=$1`, [c.paw.id, c.captureId]);
      if (refunded[i].status === "rejected") console.error(`[pounce] refund failed for capture ${c.captureId}: ${(refunded[i] as PromiseRejectedResult).reason}`);
    }
    for (const f of failed) await d.query(`update paws set status='failed' where id=$1`, [f.paw.id]);
    const hit = [...new Set(toCapture.map((u) => u.paw.user_id))];
    const why = String((results[toCapture.indexOf(failed[0])] as PromiseRejectedResult).reason?.message ?? "a capture failed");
    for (const uid of hit) {
      const theirs = failed.some((f) => f.paw.user_id === uid);
      await releaseMember(plan.id, uid, why, {
        status: "thinking",
        text: theirs ? "Your PayPal hold didn't go through, so the Pounce paused. Paw in again to stay in." : "The Pounce paused because of a PayPal problem. Your money came back. Paw in again to stay in.",
      });
    }
    await d.query(`update plans set status='open' where id=$1`, [plan.id]);
    await logEvent(d, { squadId: plan.squad_id, actor: "system", type: "pounce.paused", objectType: "plan", objectId: plan.id, public: { text: `The Pounce on ${plan.title} paused. A few people need to paw in again.` } });
    return { status: "capture_failed", userIds: failed.map((f) => f.paw.user_id) };
  }
  // 2) Release unused PayPal holds (and zero-take ones).
  await Promise.all(
    [...unused, ...uses.filter((x) => x.take === 0).map((x) => x.paw)]
      .filter((p) => p.source === "paypal" && p.authorization_id)
      .map((p) => voidHold(p.authorization_id!).catch(() => undefined)),
  );
  // 3) Pay the booker before they book.
  const total = groupIds.reduce((a, id) => a + shares[id], 0);
  const booker = await getUser(d, plan.booker_id);
  if (!booker?.paypal_email) throw new Error("The booker has no PayPal email");
  // A failed payout must never strand captured money: record the Pounce, keep the money in the plan's pot,
  // and the timer retries the payout (retryPendingPayouts). Phase 1 finding: the sandbox platform balance drains by fees.
  let payout: { batchId: string } | null = null;
  try {
    payout = await sendPayout([{ email: booker.paypal_email, cents: total, note: `Kitty: ${plan.title}`, itemId: `pounce-${plan.id.slice(0, 8)}` }], `Kitty: money for ${plan.title}`);
  } catch (e) {
    console.error(`[pounce] payout failed for ${plan.id}, will retry: ${(e as Error).message}`);
  }

  // 4) Ledger + statuses + record, all in one transaction.
  await d.tx(async (q) => {
    for (const u of uses) {
      const p = u.paw;
      if (p.source === "paypal") {
        if (u.take > 0) {
          await move(q, acct.world, acct.plan(plan.id), u.take, { kind: "capture", userId: p.user_id, planId: plan.id, paypalId: u.captureId, reason: p.kind === "cover" ? "cover for a friend" : "your share" });
          await q.query(`update paws set status='captured', captured_cents=$2, capture_id=$3 where id=$1`, [p.id, u.take, u.captureId]);
        } else await q.query(`update paws set status='voided' where id=$1`, [p.id]);
      } else if (p.source === "jar") {
        await move(q, acct.jarHeld(p.user_id), acct.plan(plan.id), u.take, { kind: "jar_spend", userId: p.user_id, planId: plan.id, reason: "your share, from your Treat Jar" });
        await move(q, acct.jarHeld(p.user_id), acct.jar(p.user_id), p.cents - u.take, { kind: "jar_release", userId: p.user_id, planId: plan.id, reason: "unused" });
        await q.query(`update paws set status='captured', captured_cents=$2 where id=$1`, [p.id, u.take]);
      } else {
        await move(q, acct.savingsHeld(plan.squad_id, p.user_id), acct.plan(plan.id), u.take, { kind: "savings_spend", userId: p.user_id, planId: plan.id, reason: "your share, from your savings" });
        await move(q, acct.savingsHeld(plan.squad_id, p.user_id), acct.savings(plan.squad_id, p.user_id), p.cents - u.take, { kind: "savings_release", userId: p.user_id, planId: plan.id, reason: "unused" });
        await q.query(`update paws set status='captured', captured_cents=$2 where id=$1`, [p.id, u.take]);
      }
    }
    for (const p of unused) await releasePawLedger(q, plan, p);
    if (payout) await move(q, acct.plan(plan.id), acct.world, total, { kind: "payout", userId: plan.booker_id, planId: plan.id, paypalId: payout.batchId, reason: "paid the booker before booking" });
    else await logEvent(q, { userId: plan.booker_id, squadId: plan.squad_id, actor: "kitten", type: "payout.delayed", objectType: "plan", objectId: plan.id, payload: { cents: total, text: "Everyone's money is in. Your payout is delayed; I'll keep trying. Don't book until it arrives." }, reason: "PayPal payout failed" });
    await q.query(`insert into pounces (plan_id, group_ids, shares, total_cents, payout_batch_id, status) values ($1,$2,$3,$4,$5,$6)`, [plan.id, groupIds, JSON.stringify(shares), total, payout?.batchId ?? null, payout ? "done" : "payout_pending"]);
    await q.query(`update plans set status='pounced' where id=$1`, [plan.id]);
    for (const uid of groupIds) {
      const parts = uses.filter((u) => u.paw.user_id === uid && u.paw.kind !== "cover");
      const by = (s: string) => parts.filter((u) => u.paw.source === s).reduce((a, u) => a + u.take, 0);
      await logEvent(q, {
        userId: uid,
        squadId: plan.squad_id,
        actor: "system",
        type: "pounce.charged",
        objectType: "plan",
        objectId: plan.id,
        payload: { shareCents: shares[uid], savingsCents: by("savings"), jarCents: by("jar"), paypalCents: by("paypal"), text: `Pounce! Your share: ${fmt(shares[uid])}` },
        paypalId: parts.find((u) => u.captureId)?.captureId ?? null,
      });
    }
    if (payout) await logEvent(q, { userId: plan.booker_id, squadId: plan.squad_id, actor: "system", type: "pounce.paid_booker", objectType: "plan", objectId: plan.id, payload: { totalCents: total, text: `${fmt(total)} is on its way to your PayPal. Book it!` }, paypalId: payout?.batchId ?? null });
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "pounce", objectType: "plan", objectId: plan.id, public: { text: `Pounce! ${groupIds.length} in for ${plan.title}. ${payout ? "The booker has been paid." : "Everyone's money is in; the booker's payout is on its way."}`, groupSize: groupIds.length } });
  });
  return { status: "pounced", groupIds, shares, totalCents: total, payoutBatchId: payout?.batchId ?? null, payoutPending: !payout };
}

async function releasePawLedger(q: Queryable, plan: PlanRow, p: Paw) {
  if (p.status !== "held") return;
  if (p.source === "jar") await move(q, acct.jarHeld(p.user_id), acct.jar(p.user_id), p.cents, { kind: "jar_release", userId: p.user_id, planId: plan.id, reason: "released" });
  if (p.source === "savings") await move(q, acct.savingsHeld(plan.squad_id, p.user_id), acct.savings(plan.squad_id, p.user_id), p.cents, { kind: "savings_release", userId: p.user_id, planId: plan.id, reason: "released" });
  await q.query(`update paws set status='voided' where id=$1`, [p.id]);
}

/** Release one member's holds (and covers they gave) — "not this time", or the share went above their limit. */
export async function releaseMember(planId: string, userId: string, reason: string, opts: { status?: "out" | "thinking"; text?: string } = {}) {
  const d = await db();
  const plan = await getPlan(d, planId);
  const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and user_id=$2 and status in ('held','pending')`, [planId, userId]);
  for (const p of paws) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
  await d.tx(async (q) => {
    for (const p of paws) {
      if (p.status === "pending") await q.query(`update paws set status='voided' where id=$1`, [p.id]);
      else await releasePawLedger(q, plan, p);
    }
    await q.query(`update plan_members set status=$3, pawup_need_cents=null where plan_id=$1 and user_id=$2`, [planId, userId, opts.status ?? "out"]);
    await logEvent(q, { userId, squadId: plan.squad_id, actor: "kitten", type: "paw.released", objectType: "plan", objectId: planId, payload: { released: paws.length, text: opts.text ?? "Not this time. Everything I held for you is released." }, reason });
  });
}

/** Deadline missed (or nobody fits): release everything, plan on ice (FR-POUNCE-7, AT-11). */
export async function putOnIce(planId: string, why: string) {
  const d = await db();
  const plan = await getPlan(d, planId);
  const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and status in ('held','pending')`, [planId]);
  for (const p of paws) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
  await d.tx(async (q) => {
    for (const p of paws) {
      if (p.status === "pending") await q.query(`update paws set status='voided' where id=$1`, [p.id]);
      else await releasePawLedger(q, plan, p);
    }
    await q.query(`update plans set status='on_ice', paw_up_round=0, pawup_until=null where id=$1`, [planId]);
    await q.query(`update plan_members set status='thinking', pawup_need_cents=null where plan_id=$1 and status='in'`, [planId]);
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "plan.on_ice", objectType: "plan", objectId: planId, public: { text: `${plan.title} is on ice. Everything held has been released.` } });
    await logEvent(q, { userId: plan.host_id, squadId: plan.squad_id, actor: "kitten", type: "plan.on_ice", objectType: "plan", objectId: planId, payload: { text: "Options: extend the deadline, lower the price, ask for cover, or cancel." }, reason: why });
  });
  return { status: "on_ice", released: paws.length };
}

/** Join after the Pounce (FR-POUNCE-8/9, AT-9): newcomer pays the new share; others get the exact difference back. */
export async function tagAlong(userId: string, planId: string, opts: { limitCents: number }) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (!["pounced", "settled"].includes(plan.status) || plan.locked_at) throw new Error("This plan can't take tag-alongs now.");
  const [pounce] = await d.query<{ id: string; group_ids: string[]; shares: Record<string, number> }>(`select id, group_ids, shares from pounces where plan_id=$1 order by created_at desc limit 1`, [planId]);
  if (pounce.group_ids.includes(userId)) throw new Error("You're already in.");
  const user = await getUser(d, userId);
  // Cost basis: the confirmed receipt total if there is one; what each person has actually paid, net of refunds.
  const [rcpt] = await d.query<{ confirmed_cents: number }>(`select confirmed_cents from receipts where plan_id=$1 and status='confirmed' order by created_at desc limit 1`, [planId]);
  const cost = rcpt && plan.price_mode === "total" ? { ...costOf(plan), priceCents: rcpt.confirmed_cents } : costOf(plan);
  const existing = [];
  for (const [i, id] of pounce.group_ids.entries()) {
    const net = (await paidParts(d, planId, id)).reduce((a, p) => a + p.cents, 0);
    existing.push({ id, order: i + 1, paidCents: net || pounce.shares[id] });
  }
  const math = tagAlongMath(cost, existing, { id: userId, order: existing.length + 1 });
  if (math.newcomerPays > opts.limitCents) return { ok: false, needCents: math.newcomerPays };
  if (!user?.is_demo) throw new Error("Tag along for real users needs a PayPal approval flow (Phase 3 screens).");
  const pay = await testCardPayment({ cents: math.newcomerPays, customId: `tag:${userId.slice(0, 8)}` });

  // Refund each existing member, split across the sources they paid from (PayPal / Treat Jar / savings).
  const refundsDone: { userId: string; cents: number; source: string; refundId?: string; captureId?: string }[] = [];
  for (const [uid, cents] of Object.entries(math.refunds)) {
    const paid = await paidParts(d, planId, uid);
    for (const part of leftovers(paid, cents)) {
      if (part.source === "paypal") {
        const caps = await d.query<{ capture_id: string; captured_cents: number }>(`select capture_id, captured_cents from paws where plan_id=$1 and user_id=$2 and source='paypal' and status='captured' and kind <> 'cover' order by captured_cents desc`, [planId, uid]);
        const r = await refundCapture(caps[0].capture_id, part.cents);
        refundsDone.push({ userId: uid, cents: part.cents, source: "paypal", refundId: r.refundId, captureId: caps[0].capture_id });
      } else refundsDone.push({ userId: uid, cents: part.cents, source: part.source });
    }
  }
  await d.tx(async (q) => {
    await move(q, acct.world, acct.plan(planId), math.newcomerPays, { kind: "tag_along", userId, planId, paypalId: pay.captureId, reason: "you tagged along" });
    for (const r of refundsDone) {
      const to = r.source === "paypal" ? acct.world : r.source === "jar" ? acct.jar(r.userId) : acct.savings(plan.squad_id, r.userId);
      await move(q, acct.plan(planId), to, r.cents, { kind: "refund", userId: r.userId, planId, paypalId: r.refundId, reason: "someone tagged along, so your share dropped" });
      await q.query(`insert into refunds (plan_id, user_id, cents, source, paypal_refund_id, capture_id, reason) values ($1,$2,$3,$4,$5,$6,'tag_along')`, [planId, r.userId, r.cents, r.source, r.refundId ?? null, r.captureId ?? null]);
    }
    await q.query(
      `insert into plan_members (plan_id, user_id, status, joined_at, limit_cents) values ($1,$2,'in',now(),$3)
       on conflict (plan_id,user_id) do update set status='in', limit_cents=excluded.limit_cents`,
      [planId, userId, opts.limitCents],
    );
    await q.query(`update pounces set group_ids=$2, shares=$3 where id=$1`, [pounce.id, [...pounce.group_ids, userId], JSON.stringify(math.newShares)]);
    await logEvent(q, { userId, squadId: plan.squad_id, actor: "user", actorId: userId, type: "tag_along.paid", objectType: "plan", objectId: planId, payload: { cents: math.newcomerPays }, paypalId: pay.captureId });
    for (const [uid, cents] of Object.entries(math.refunds)) {
      await logEvent(q, { userId: uid, squadId: plan.squad_id, actor: "system", type: "tag_along.refund", objectType: "plan", objectId: planId, payload: { cents, text: `Someone tagged along: ${fmt(cents)} back to you.` } });
    }
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "tag_along", objectType: "plan", objectId: planId, public: { text: `Someone tagged along on ${plan.title}. Everyone's share just dropped.` } });
  });
  return { ok: true, newcomerPays: math.newcomerPays, refunds: math.refunds };
}

/** What a member has paid into a plan, NET of refunds so far, by source (ledger + refunds). */
export async function paidParts(q: Queryable, planId: string, userId: string): Promise<Paid[]> {
  const rows = await q.query<{ kind: string; c: string }>(
    `select kind, sum(amount_cents) as c from ledger where plan_id=$1 and user_id=$2 and account=$3
       and kind in ('capture','jar_spend','savings_spend','tag_along') and amount_cents > 0 group by kind`,
    [planId, userId, acct.plan(planId)],
  );
  const src = (k: string) => (k === "capture" || k === "tag_along" ? "paypal" : k === "jar_spend" ? "jar" : "savings") as Paid["source"];
  const gross = new Map<Paid["source"], number>();
  rows.forEach((r) => gross.set(src(r.kind), (gross.get(src(r.kind)) ?? 0) + Number(r.c)));
  const back = await q.query<{ source: Paid["source"]; c: string }>(
    `select source, sum(cents) as c from refunds where plan_id=$1 and user_id=$2 group by source`,
    [planId, userId],
  );
  back.forEach((b) => gross.set(b.source, (gross.get(b.source) ?? 0) - Number(b.c)));
  return [...gross.entries()].map(([source, cents]) => ({ userId, source, cents })).filter((p) => p.cents > 0);
}

/** Tick helper (FR-POUNCE-10): when a plan enters its last 72 h, place holds for members who said "in" early. */
export async function placeDueHolds(now = new Date()) {
  const d = await db();
  const due = await d.query<{ plan_id: string; user_id: string; limit_cents: number; use_savings: boolean }>(
    `select m.plan_id, m.user_id, m.limit_cents, m.use_savings from plan_members m join plans p on p.id=m.plan_id
     where p.status='open' and m.status='in' and m.limit_cents is not null
       and p.decide_by <= $1::timestamptz + interval '72 hours'
       and not exists (select 1 from paws w where w.plan_id=m.plan_id and w.user_id=m.user_id and w.status in ('pending','held'))`,
    [now.toISOString()],
  );
  for (const m of due) {
    const plan = await getPlan(d, m.plan_id);
    await placeForLimit(plan, m.user_id, m.limit_cents, m.use_savings, null);
  }
  return due.length;
}

/** Timer job: retry booker payouts that failed at Pounce time (the money is waiting in the plan's pot). */
export async function retryPendingPayouts() {
  const d = await db();
  const rows = await d.query<{ id: string; plan_id: string; total_cents: number }>(`select id, plan_id, total_cents from pounces where status='payout_pending'`);
  let sent = 0;
  for (const r of rows) {
    const plan = await getPlan(d, r.plan_id);
    const booker = await getUser(d, plan.booker_id);
    if (!booker?.paypal_email) continue;
    try {
      const p = await sendPayout([{ email: booker.paypal_email, cents: r.total_cents, note: `Kitty: ${plan.title}`, itemId: `pounce-${plan.id.slice(0, 8)}-r${Date.now()}` }], `Kitty: money for ${plan.title}`);
      await d.tx(async (q) => {
        await move(q, acct.plan(plan.id), acct.world, r.total_cents, { kind: "payout", userId: plan.booker_id, planId: plan.id, paypalId: p.batchId, reason: "paid the booker (retry)" });
        await q.query(`update pounces set status='done', payout_batch_id=$2 where id=$1`, [r.id, p.batchId]);
        await logEvent(q, { userId: plan.booker_id, squadId: plan.squad_id, actor: "kitten", type: "payout.sent", objectType: "plan", objectId: plan.id, payload: { cents: r.total_cents, text: "Your payout arrived. You can book now." }, paypalId: p.batchId });
        await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "pounce.paid_booker", objectType: "plan", objectId: plan.id, public: { text: `The booker has been paid for ${plan.title}.` } });
      });
      sent++;
    } catch (e) {
      console.error(`[pounce] payout retry failed for ${plan.id}: ${(e as Error).message}`);
    }
  }
  return sent;
}
