import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { calendar, committedCents, jarBalances, monthSpentCents, savingsBalance, windowOf } from "./month";
import { getKitten, getUser, listRules } from "./users";
import { costOf, getPlan, type PlanRow } from "./plans";
import { funBudgetCents } from "../referee/rules";
import { checkGroup, solveGroup, type Candidate } from "../referee/pounce";
import { leftovers, tagAlong as tagAlongMath, type Paid } from "../referee/settle";
import { clash } from "../referee/time";
import { authorizeHold, captureHold, createCheckout, createTestCardHold, refundCapture, testCardPayment, voidHold } from "../paypal/holds";
import { sendPayout } from "../paypal/payouts";
import { baseUrl } from "../env";
import { withLock } from "./locks";
import { refillOrAsk, type JarShort, type Refill } from "./money-flow";
import { giveBack, setAside, shortOf } from "./set-aside";
import { planShares, type ShareMember } from "../referee/shares";

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

/**
 * Set `cents` aside for a user (FR-POUNCE-1). They tapped, so the Treat Jar pays whatever the amount: the free hand only
 * limits what the kitten does alone. If the jar is short, a real person refills just the difference and the jar pays when
 * they come back (finishJarRefill). Demo friends can't approve anything, so they hold the sandbox test card instead.
 */
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
  const jar = await jarBalances(d, userId);
  if (jar.availableCents >= cents) {
    const pawId = await d.tx(async (q) => {
      await move(q, acct.jar(userId), acct.jarHeld(userId), cents, { kind: "jar_reserve", userId, planId: plan.id, reason: `${kind} from Treat Jar` });
      const [paw] = await q.query<{ id: string }>(
        `insert into paws (plan_id, user_id, kind, source, cents, cover_for, status) values ($1,$2,$3,'jar',$4,$5,'held') returning id`,
        [plan.id, userId, kind, cents, coverFor],
      );
      return paw.id;
    });
    return { pawId, source: "jar", reason: "from your Treat Jar" };
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
  const short = cents - jar.availableCents;
  const [paw] = await d.query<{ id: string }>(
    `insert into paws (plan_id, user_id, kind, source, cents, cover_for, status) values ($1,$2,$3,'jar',$4,$5,'pending') returning id`,
    [plan.id, userId, kind, cents, coverFor],
  );
  const base = baseUrl();
  const { orderId, approveUrl } = await createCheckout({
    cents: short,
    customId: `jar:${userId}`,
    description: `Kitty Treat Jar refill for ${plan.title}`.slice(0, 120),
    returnUrl: `${base}/api/v1/return/jar`,
    cancelUrl: `${base}/?cancelled=jar`,
  });
  await d.query(`update paws set order_id=$2, approve_url=$3 where id=$1`, [paw.id, orderId, approveUrl]);
  return { pawId: paw.id, source: "jar", approveUrl, reason: `your Treat Jar is ${fmt(short)} short` };
}

export type PawInResult =
  | { ok: true; deferred?: boolean; savingsCents: number; jarCents: number; paypalCents: number; approveUrl?: string; pounce?: unknown }
  | { ok: false; code: "clash"; withPlan: string }
  | { ok: false; code: "over_budget"; overByCents: number }
  | JarShort;

/** A paw-up or a cover: a real person is asked before a refill. Demo friends can't be asked. */
async function askIfShort(userId: string, cents: number, refill?: boolean): Promise<JarShort | null> {
  const d = await db();
  if (refill || (await getUser(d, userId))?.is_demo) return null;
  const { availableCents } = await jarBalances(d, userId);
  return availableCents < cents ? { ok: false, code: "jar_short", shortCents: cents - availableCents, jarCents: availableCents } : null;
}

/** How far the Treat Jar falls short of a paw-in, counting what comes back if this person's earlier paw-in is being replaced. */
async function jarShort(plan: PlanRow, userId: string, limit: number, useSavings: boolean, replacing: boolean) {
  const d = await db();
  const mine = replacing ? await d.query<{ source: string; c: number }>(`select source, sum(cents)::int as c from paws where plan_id=$1 and user_id=$2 and status='held' group by source`, [plan.id, userId]) : [];
  const back = (s: string) => mine.find((m) => m.source === s)?.c ?? 0;
  const savings = useSavings ? (await savingsBalance(d, plan.squad_id, userId)) + back("savings") : 0;
  const rest = limit - Math.min(savings, limit);
  const jarCents = (await jarBalances(d, userId)).availableCents + back("jar");
  return { shortCents: Math.max(0, rest - jarCents), jarCents };
}

/** Paw in "up to $X" (FR-POUNCE-1): own savings first, then the Treat Jar, and a refill for the difference if it's short. */
export async function pawIn(
  userId: string,
  planId: string,
  opts: { limitCents: number; useSavings?: boolean; confirmOverBudget?: boolean; confirmBusy?: boolean; changeLimit?: boolean; refill?: boolean },
): Promise<PawInResult> {
  // One at a time per person per plan: a double tap must not place two holds (edge case B9).
  return withLock(`paw:${planId}:${userId}`, () => pawInNow(userId, planId, opts));
}

async function pawInNow(userId: string, planId: string, opts: { limitCents: number; useSavings?: boolean; confirmOverBudget?: boolean; confirmBusy?: boolean; changeLimit?: boolean; refill?: boolean }): Promise<PawInResult> {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "open") throw new Error("This plan isn't open.");
  if (new Date(plan.decide_by).getTime() <= Date.now()) throw new Error("The deadline for this plan has passed.");
  if (plan.price_cents <= 0) throw new Error("The host hasn't set a price yet.");
  const limit = opts.limitCents;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("Pick an amount.");
  const existing = await d.query<{ status: string }>(`select status from paws where plan_id=$1 and user_id=$2 and kind='initial' and status in ('pending','held')`, [planId, userId]);
  // A paw-in still waiting on a refill they never finished can simply be started again.
  const stalled = existing.length > 0 && existing.every((p) => p.status === "pending");
  if (existing.length && !opts.changeLimit && !stalled) throw new Error("You're already in. Use paw up to raise your limit.");
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

  // A short Treat Jar asks before anything moves, so a person's earlier paw-in is still safe if they say not now.
  const useSavings = opts.useSavings ?? true;
  const person = await getUser(d, userId);
  if (!person?.is_demo && !opts.refill) {
    const { shortCents, jarCents } = await jarShort(plan, userId, limit, useSavings, existing.length > 0);
    if (shortCents > 0) return { ok: false, code: "jar_short", shortCents, jarCents };
  }
  // Changing your limit (F14): the old hold goes back first, then the new one is placed below.
  if (existing.length) await releaseMember(planId, userId, "changing their limit", { status: "thinking", text: "Your old hold is released. Placing the new one." });

  await d.query(
    `insert into plan_members (plan_id, user_id, status) values ($1,$2,'thinking') on conflict (plan_id, user_id) do nothing`,
    [planId, userId],
  );
  await d.query(`update plan_members set limit_cents=$3, use_savings=$4, joined_at=coalesce(joined_at, now()) where plan_id=$1 and user_id=$2`, [
    planId,
    userId,
    limit,
    useSavings,
  ]);

  // PayPal holds are placed only in the last 72 h before the deadline (FR-POUNCE-10). Treat Jar money has no such limit.
  if (person?.is_demo && new Date(plan.decide_by).getTime() - Date.now() > 72 * 3600_000) {
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
  await d.query(`update plan_members set status=$3 where plan_id=$1 and user_id=$2`, [plan.id, userId, pending && userId !== plan.host_id ? "thinking" : "in"]);
  await logEvent(d, {
    userId,
    squadId: plan.squad_id,
    actor: "kitten",
    actorId: userId,
    type: "paw.placed",
    objectType: "plan",
    objectId: plan.id,
    payload: { limitCents: limit, savingsCents, jarCents, paypalCents, pending, softBusy, text: pending ? `Your Treat Jar needs a refill, then I'll set aside up to ${fmt(limit)}.` : `Paw in up to ${fmt(limit)}: ${[savingsCents && `${fmt(savingsCents)} savings`, jarCents && `${fmt(jarCents)} Treat Jar`, paypalCents && `${fmt(paypalCents)} PayPal hold`].filter(Boolean).join(", ")}.` },
    reason: reason || "covered by your savings",
    paypalId: (await d.query<{ authorization_id: string | null }>(`select authorization_id from paws where plan_id=$1 and user_id=$2 and authorization_id is not null order by created_at desc limit 1`, [plan.id, userId]))[0]?.authorization_id ?? null,
  });
  if (!pending) await publicIn(d, plan, userId);
  const pounce = pending ? undefined : await tryPounce(plan.id, {});
  return { ok: true, savingsCents, jarCents, paypalCents, approveUrl, pounce };
}

// ---------------------------------------------------------------- the plan collects the money (FR-PLAN-9..12)

async function inGroup(q: Queryable, plan: PlanRow): Promise<ShareMember[]> {
  const rows = await q.query<{ user_id: string; weight: number; custom_cents: number | null }>(`select user_id, weight, custom_cents from plan_members where plan_id=$1 and status='in' order by joined_at nulls last, user_id`, [plan.id]);
  return rows.map((r, i) => ({ id: r.user_id, order: i + 1, weight: r.weight, customCents: r.custom_cents }));
}

/** Everyone's share right now. Below "need at least" the empty seats still count, so nobody pays more than they were quoted. */
function sharesNow(plan: PlanRow, group: ShareMember[]): Record<string, number> {
  const seats = [...group];
  for (let i = group.length; i < plan.need_at_least; i++) seats.push({ id: `seat-${i}`, order: 10_000 + i });
  return seats.length ? planShares(costOf(plan), seats) : {};
}

/** Everyone's share in this plan right now (used when a whim turns into a plan). */
export async function sharesFor(q: Queryable, planId: string) {
  const plan = await getPlan(q, planId);
  return sharesNow(plan, await inGroup(q, plan));
}

/** Where the money stands: what each person owes, what's in, and who it's still waiting on. */
export async function moneyState(q: Queryable, plan: PlanRow) {
  const group = await inGroup(q, plan);
  const shares = sharesNow(plan, group);
  const rows = await q.query<{ user_id: string; c: number }>(`select user_id, sum(cents)::int as c from paws where plan_id=$1 and status='held' and kind <> 'cover' group by user_id`, [plan.id]);
  const held = Object.fromEntries(rows.map((r) => [r.user_id, Number(r.c)]));
  const unpaid = group.filter((m) => (held[m.id] ?? 0) < shares[m.id]).map((m) => m.id);
  return {
    shares: Object.fromEntries(group.map((m) => [m.id, shares[m.id]])) as Record<string, number>,
    held: held as Record<string, number>,
    unpaid,
    allPaid: group.length > 0 && unpaid.length === 0,
    collectedCents: group.reduce((a, m) => a + Math.min(held[m.id] ?? 0, shares[m.id]), 0),
    targetCents: group.reduce((a, m) => a + shares[m.id], 0),
  };
}

/** Make one person's money match their share. True if it's all in; false if their Treat Jar is short and a card asks for a refill. */
async function setShare(plan: PlanRow, userId: string, target: number): Promise<boolean> {
  const d = await db();
  const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and user_id=$2 and status='held' and kind <> 'cover' order by source='jar' desc, created_at`, [plan.id, userId]);
  const had = paws.reduce((a, p) => a + p.cents, 0);
  await d.query(`update plan_members set limit_cents=$3 where plan_id=$1 and user_id=$2`, [plan.id, userId, target]);
  if (had === target) return true;

  if (had > target) {
    // More people joined, so the share came down: the difference goes back where it came from.
    let extra = had - target;
    for (const p of paws) {
      if (extra <= 0 || p.source === "paypal") continue;
      const back = Math.min(extra, p.cents);
      extra -= back;
      await d.tx(async (q) => {
        if (p.source === "jar") await move(q, acct.jarHeld(userId), acct.jar(userId), back, { kind: "jar_release", userId, planId: plan.id, reason: "your share came down" });
        else await move(q, acct.savingsHeld(plan.squad_id, userId), acct.savings(plan.squad_id, userId), back, { kind: "savings_release", userId, planId: plan.id, reason: "your share came down" });
        await q.query(`update paws set cents=cents-$2, status=case when cents-$2=0 then 'voided' else status end where id=$1`, [p.id, back]);
      });
    }
    await logEvent(d, { userId, squadId: plan.squad_id, actor: "kitten", type: "plan.share_changed", objectType: "plan", objectId: plan.id, payload: { cents: target, text: `More people joined "${plan.title}", so your share is now ${fmt(target)}. ${fmt(had - target)} went back to you.` }, reason: "someone joined" });
    return true;
  }

  let need = target - had;
  const bits: string[] = [];
  if (plan.use_savings) {
    const fromSavings = Math.min(await savingsBalance(d, plan.squad_id, userId), need);
    if (fromSavings > 0) {
      await d.tx(async (q) => {
        await move(q, acct.savings(plan.squad_id, userId), acct.savingsHeld(plan.squad_id, userId), fromSavings, { kind: "savings_reserve", userId, planId: plan.id, reason: "your share, from your Kitty Party savings" });
        await q.query(`insert into paws (plan_id, user_id, kind, source, cents, status) values ($1,$2,'initial','savings',$3,'held')`, [plan.id, userId, fromSavings]);
      });
      need -= fromSavings;
      bits.push(`${fmt(fromSavings)} from your Kitty Party savings`);
    }
  }
  if (need > 0) {
    let { availableCents } = await jarBalances(d, userId);
    if (availableCents < need && (await getUser(d, userId))?.is_demo) {
      // Demo friends can't approve a refill, so the sandbox test card fills the jar for them.
      const short = need - availableCents;
      const pay = await testCardPayment({ cents: short, customId: `jar:${userId}` });
      await d.tx((q) => move(q, acct.world, acct.jar(userId), short, { kind: "jar_topup", userId, paypalId: pay.captureId, reason: "Treat Jar top-up" }));
      availableCents += short;
    }
    if (availableCents < need) return false;
    await d.tx(async (q) => {
      await move(q, acct.jar(userId), acct.jarHeld(userId), need, { kind: "jar_reserve", userId, planId: plan.id, reason: "your share, from your Treat Jar" });
      await q.query(`insert into paws (plan_id, user_id, kind, source, cents, status) values ($1,$2,'initial','jar',$3,'held')`, [plan.id, userId, need]);
    });
    bits.push(`${fmt(need)} from your Treat Jar`);
  }
  await logEvent(d, { userId, squadId: plan.squad_id, actor: "kitten", type: "paw.placed", objectType: "plan", objectId: plan.id, payload: { cents: target, text: had > 0 ? `Someone dropped out of "${plan.title}", so your share is now ${fmt(target)}. I put in the extra: ${bits.join(" and ")}.` : `Your ${fmt(target)} for "${plan.title}" is in: ${bits.join(" and ")}.` }, reason: had > 0 ? "someone dropped out" : "you said yes" });
  if (had === 0) await publicIn(d, plan, userId);
  return true;
}

/** Bring everyone's money into line with the group as it stands now. Callers hold the plan's lock. */
async function syncNow(plan: PlanRow) {
  const d = await db();
  const group = await inGroup(d, plan);
  // Whoever was booking can't book a plan they're not on.
  if (!group.some((m) => m.id === plan.booker_id)) {
    await d.query(`update plans set booker_id=host_id where id=$1`, [plan.id]);
    plan.booker_id = plan.host_id;
  }
  const shares = sharesNow(plan, group);
  for (const m of group) await setShare(plan, m.id, shares[m.id]);
}

export async function syncShares(planId: string) {
  return withLock(`pounce:${planId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.status === "open") await syncNow(plan);
  });
}

/** Put my share in. If the Treat Jar is short, ask to refill just the difference (FR-JAR-7). */
export async function chipIn(userId: string, planId: string, refill?: boolean) {
  return withLock(`pounce:${planId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.status !== "open") throw new Error("This plan isn't collecting money any more.");
    if (new Date(plan.decide_by).getTime() <= Date.now()) throw new Error("The deadline for this plan has passed.");
    const group = await inGroup(d, plan);
    if (!group.some((m) => m.id === userId)) throw new Error("You're not in this plan.");
    const target = sharesNow(plan, group)[userId];
    if (await setShare(plan, userId, target)) return { ok: true as const, paid: true };
    const held = (await moneyState(d, plan)).held[userId] ?? 0;
    const { availableCents } = await jarBalances(d, userId);
    return refillOrAsk(userId, target - held - availableCents, availableCents, { refill, after: `chip:${planId}`, reason: `your share of ${plan.title}` });
  });
}

/** Money just landed in this person's jar: any share it was waiting for goes in straight away. */
export async function chipInWaiting(userId: string) {
  const d = await db();
  const plans = await d.query<{ id: string }>(`select p.id from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 and m.status='in' where p.status='open' and p.decide_by > now()`, [userId]);
  for (const p of plans) await chipIn(userId, p.id).catch((e) => console.error(`[plan] chip in after top-up: ${(e as Error).message}`));
}

/** Someone who didn't say yes joins before the Pounce: no asking, same price, a smaller share for everyone (FR-PLAN-11). */
async function joinOpen(userId: string, plan: PlanRow, refill?: boolean) {
  const d = await db();
  if (new Date(plan.decide_by).getTime() <= Date.now()) throw new Error("The deadline for this plan has passed.");
  const inSquad = await d.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [plan.squad_id, userId]);
  if (!inSquad.length) throw new Error("You're not in this plan's group.");
  const [me] = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1 and user_id=$2`, [plan.id, userId]);
  if (me?.status === "in") return { ok: true as const, already: true };
  const cal = await calendar(d, userId, plan.id);
  const busy = clash(windowOf(plan.starts_at, plan.ends_at), cal.plansIn, []);
  if (busy.hard) throw new Error(`You're already in ${cal.plansIn.find((p) => p.planId === busy.hard!.planId)?.title ?? "another plan"} then.`);
  const group = await inGroup(d, plan);
  const mine = sharesNow(plan, [...group, { id: userId, order: group.length + 1 }])[userId];
  const user = await getUser(d, userId);
  if (!user?.is_demo) {
    const savings = plan.use_savings ? await savingsBalance(d, plan.squad_id, userId) : 0;
    const { availableCents } = await jarBalances(d, userId);
    if (savings + availableCents < mine) return refillOrAsk(userId, mine - savings - availableCents, availableCents, { refill, after: `join:${plan.id}`, reason: `your share of ${plan.title}` });
  }
  await d.query(`insert into plan_members (plan_id, user_id, status, joined_at) values ($1,$2,'in',now()) on conflict (plan_id, user_id) do update set status='in', joined_at=now()`, [plan.id, userId]);
  await syncNow(plan);
  return { ok: true as const, newcomerPays: mine };
}

/** It's time for the event and the host never tapped Pounce: nothing happened, so everyone's money goes back. */
export async function neverPounced(planId: string) {
  return withLock(`pounce:${planId}`, () => putOnIce(planId, "the host didn't Pounce before it started"));
}

/** The deadline: anyone whose share still isn't in is out. If enough are left, the host can Pounce; if not, it's on ice (FR-POUNCE-11). */
export async function deadlinePassed(planId: string) {
  return withLock(`pounce:${planId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.status !== "open") return { status: plan.status };
    // Someone leaving raises the others' shares, so this can take a couple of passes.
    for (let pass = 0; pass < 20; pass++) {
      const state = await moneyState(d, plan);
      const inCount = Object.keys(state.shares).length;
      if (inCount < plan.need_at_least) return putOnIce(planId, "not enough people's money came in by the deadline");
      if (!state.unpaid.length) return { status: "ready", inCount };
      if (state.unpaid.includes(plan.host_id)) return putOnIce(planId, "the host's share wasn't in by the deadline");
      for (const id of state.unpaid) await releaseMember(planId, id, "the deadline passed", { text: `The deadline for "${plan.title}" passed before your share was in, so you're out of this one.` });
      await syncNow(plan);
    }
    return putOnIce(planId, "the shares never settled by the deadline");
  });
}

/** Back from refilling the Treat Jar: what was waiting on the refill now comes out of the jar (FR-POUNCE-1). */
export async function finishJarRefill(orderId: string): Promise<{ planId: string } | null> {
  const d = await db();
  const [found] = await d.query<Paw>(`select * from paws where order_id=$1 and source='jar'`, [orderId]);
  if (!found) return null;
  return withLock(`paw:${found.plan_id}:${found.user_id}`, async () => {
    const [paw] = await d.query<Paw>(`select * from paws where id=$1`, [found.id]);
    const plan = await getPlan(d, paw.plan_id);
    if (paw.status !== "pending") return { planId: plan.id };
    if (plan.status !== "open") {
      // The plan closed while they were on PayPal. The refill stays in their jar; nothing is set aside.
      await d.query(`update paws set status='voided' where id=$1`, [paw.id]);
      return { planId: plan.id };
    }
    await d.tx(async (q) => {
      await move(q, acct.jar(paw.user_id), acct.jarHeld(paw.user_id), paw.cents, { kind: "jar_reserve", userId: paw.user_id, planId: plan.id, reason: `${paw.kind} from Treat Jar` });
      await q.query(`update paws set status='held' where id=$1`, [paw.id]);
    });
    await logEvent(d, { userId: paw.user_id, squadId: plan.squad_id, actor: "kitten", type: "paw.placed", objectType: "plan", objectId: plan.id, payload: { limitCents: paw.cents, text: `You refilled your Treat Jar, and I set aside ${fmt(paw.cents)} from it.` }, reason: "you refilled your Treat Jar for this plan" });
    const stillPending = await d.query(`select 1 from paws where plan_id=$1 and user_id=$2 and status='pending'`, [plan.id, paw.user_id]);
    if (!stillPending.length && paw.kind === "initial") {
      await d.query(`update plan_members set status='in' where plan_id=$1 and user_id=$2`, [plan.id, paw.user_id]);
      await publicIn(d, plan, paw.user_id);
    }
    await tryPounce(plan.id, {});
    return { planId: plan.id };
  });
}

/** Back from PayPal after approving a hold (only holds started before paw-ins moved to the Treat Jar). */
export async function finishWalletHold(orderId: string) {
  const d = await db();
  const [paw] = await d.query<Paw>(`select * from paws where order_id=$1`, [orderId]);
  if (!paw) throw new Error("Unknown hold");
  if (paw.status !== "pending") return { planId: paw.plan_id, already: true };
  const [pl] = await d.query<{ status: string }>(`select status from plans where id=$1`, [paw.plan_id]);
  if (pl?.status !== "open") {
    // The plan closed while they were on PayPal: don't place the hold at all (nothing to release later).
    await d.query(`update paws set status='voided' where id=$1`, [paw.id]);
    return { planId: paw.plan_id, closed: true };
  }
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
export async function answerPawUp(userId: string, planId: string, accept: boolean, refill?: boolean) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "open") throw new Error("This plan isn't open.");
  const [m] = await d.query<{ pawup_need_cents: number | null; limit_cents: number | null }>(
    `select pawup_need_cents, limit_cents from plan_members where plan_id=$1 and user_id=$2`,
    [planId, userId],
  );
  if (!m?.pawup_need_cents) throw new Error("No paw-up waiting.");
  if (!accept) {
    if (userId === plan.host_id) throw new Error("You're the host, so you're in. To call it off, cancel the plan.");
    await releaseMember(planId, userId, "you chose not to paw up");
  } else {
    const short = await askIfShort(userId, m.pawup_need_cents, refill);
    if (short) return short;
    const h = await placeHold(plan, userId, m.pawup_need_cents, "paw_up");
    await d.query(`update plan_members set limit_cents=coalesce(limit_cents,0)+$3, pawup_need_cents=null where plan_id=$1 and user_id=$2`, [planId, userId, m.pawup_need_cents]);
    await logEvent(d, { userId, squadId: plan.squad_id, actor: "user", actorId: userId, type: "paw.up", objectType: "plan", objectId: planId, payload: { cents: m.pawup_need_cents, source: h.source, approveUrl: h.approveUrl }, reason: h.reason });
    if (h.approveUrl) return { ok: true, approveUrl: h.approveUrl };
  }
  return { ok: true, pounce: await tryPounce(planId, {}) };
}

/** Cover part of a friend's share, funded up front by the coverer, anonymous by default (FR-POUNCE-5). */
export async function coverFriend(fromId: string, planId: string, toId: string, cents: number, refill?: boolean) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (fromId === toId) throw new Error("You can't cover yourself.");
  // A cover on a plan that can't Pounce any more would sit on hold forever (edge cases B7, B8).
  if (plan.status !== "open") throw new Error("This plan isn't open, so there's nothing to cover.");
  if (new Date(plan.decide_by).getTime() <= Date.now()) throw new Error("The deadline for this plan has passed.");
  const [them] = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1 and user_id=$2`, [planId, toId]);
  if (!them || !["in", "thinking"].includes(them.status)) throw new Error("You can only cover someone who's taking part.");
  const short = await askIfShort(fromId, cents, refill);
  if (short) return short;
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

/** Only the host Pounces, and only once enough people are in and everyone's money has arrived (FR-POUNCE-11). */
export async function tryPounce(planId: string, opts: { hostTapped?: boolean }) {
  // One Pounce at a time per plan: a double tap and the timer can arrive together (edge case B14).
  return withLock(`pounce:${planId}`, () => tryPounceNow(planId, opts));
}

async function tryPounceNow(planId: string, opts: { hostTapped?: boolean }) {
  const d = await db();
  const plan = await getPlan(d, planId);
  if (plan.status !== "open") return { status: plan.status };
  if (!opts.hostTapped) return { status: "waiting" };
  const members = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1`, [planId]);
  const invited = members.filter((m) => m.status !== "out").length;
  const cands = await candidatesFor(d, plan);
  if (cands.length < plan.need_at_least) return { status: "waiting", inCount: cands.length, invited };
  const cost = costOf(plan);
  if (checkGroup(cost, cands).short.length) return { status: "waiting_money", inCount: cands.length, invited, why: "Not everyone's money is in yet." };
  const sol = solveGroup(cost, cands, plan.need_at_least);
  if (!sol.feasible) return { status: "waiting", inCount: cands.length, invited };
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
  // 3) The whole pot goes to the booker's Treat Jar, ready to book with (FR-POUNCE-12). No PayPal call, so nothing can fail here.
  const total = groupIds.reduce((a, id) => a + shares[id], 0);
  const booker = await getUser(d, plan.booker_id);
  const bookerName = booker?.name ?? "The booker";

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
    await move(q, acct.plan(plan.id), acct.jar(plan.booker_id), total, { kind: "pot_to_booker", userId: plan.booker_id, planId: plan.id, reason: `everyone's money for ${plan.title}` });
    await q.query(`insert into pounces (plan_id, group_ids, shares, total_cents, status) values ($1,$2,$3,$4,'done')`, [plan.id, groupIds, JSON.stringify(shares), total]);
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
        payload: { shareCents: shares[uid], savingsCents: by("savings"), jarCents: by("jar"), paypalCents: by("paypal"), text: uid === plan.booker_id ? `"${plan.title}" is final. Everyone's ${fmt(total)} is in your Treat Jar. Book it, then add the receipt.` : `"${plan.title}" is final. ${bookerName} is booking it now with everyone's money. Your share was ${fmt(shares[uid])}.` },
        paypalId: parts.find((u) => u.captureId)?.captureId ?? null,
      });
    }
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "pounce", objectType: "plan", objectId: plan.id, public: { text: `Pounce! ${groupIds.length} in for ${plan.title}. ${bookerName} is booking it.`, groupSize: groupIds.length } });
  });
  return { status: "pounced", groupIds, shares, totalCents: total };
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
    // The host's money can go back, but the host stays in (FR-PLAN-8): the card asks them to set it aside again.
    const hosting = userId === plan.host_id;
    await q.query(`update plan_members set status=$3, pawup_need_cents=null, limit_cents=case when $4::boolean then null else limit_cents end where plan_id=$1 and user_id=$2`, [planId, userId, hosting ? "in" : (opts.status ?? "out"), hosting]);
    await logEvent(q, { userId, squadId: plan.squad_id, actor: "kitten", type: "paw.released", objectType: "plan", objectId: planId, payload: { released: paws.length, text: opts.text ?? "Not this time. Everything I held for you is released." }, reason });
  });
}

/** Release every hold on a plan (Treat Jar and savings back, pending approvals voided); the caller sets the status. */
async function releaseAll(q: Queryable, plan: PlanRow, paws: Paw[]) {
  for (const p of paws) {
    if (p.status === "pending") await q.query(`update paws set status='voided' where id=$1`, [p.id]);
    else await releasePawLedger(q, plan, p);
  }
}

/** Deadline missed (or nobody fits): release everything, plan on ice (FR-POUNCE-7, AT-11). */
export async function putOnIce(planId: string, why: string) {
  const d = await db();
  const plan = await getPlan(d, planId);
  const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and status in ('held','pending')`, [planId]);
  for (const p of paws) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
  await d.tx(async (q) => {
    await releaseAll(q, plan, paws);
    await q.query(`update plans set status='on_ice', paw_up_round=0, pawup_until=null where id=$1`, [planId]);
    await q.query(`update plan_members set pawup_need_cents=null, limit_cents=null where plan_id=$1 and status='in'`, [planId]);
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "plan.on_ice", objectType: "plan", objectId: planId, public: { text: `${plan.title} is on ice. Everything held has been released.` } });
    await logEvent(q, { userId: plan.host_id, squadId: plan.squad_id, actor: "kitten", type: "plan.on_ice", objectType: "plan", objectId: planId, payload: { text: `"${plan.title}" is on ice. Give it more time, or cancel it.` }, reason: why });
  });
  return { status: "on_ice", released: paws.length };
}

/**
 * The host cancels (PRD §B8: "the host can extend, change the price, or cancel"). Only before the Pounce: every hold
 * is released, paw-up asks and suggestions close, and each member's kitten tells them privately. After the Pounce
 * the booker has the money, so the receipt (and its refunds) settles it instead.
 */
export async function cancelPlan(hostId: string, planId: string) {
  return withLock(`pounce:${planId}`, async () => {
    const d = await db();
    const plan = await getPlan(d, planId);
    if (plan.host_id !== hostId) throw new Error("Only the host can cancel this plan.");
    if (plan.status === "cancelled") throw new Error("This plan is already cancelled.");
    if (!["open", "on_ice"].includes(plan.status)) throw new Error("This plan has already Pounced, so it can't be cancelled. Add the receipt and any leftover goes back.");
    const paws = await d.query<Paw>(`select * from paws where plan_id=$1 and status in ('held','pending')`, [planId]);
    for (const p of paws) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
    const members = await d.query<{ user_id: string }>(`select user_id from plan_members where plan_id=$1 and user_id<>$2 and status<>'out'`, [planId, hostId]);
    await d.tx(async (q) => {
      await releaseAll(q, plan, paws);
      await q.query(`update plans set status='cancelled', paw_up_round=0, pawup_until=null where id=$1`, [planId]);
      await q.query(`update plan_members set pawup_need_cents=null where plan_id=$1`, [planId]);
      await q.query(`update suggestions set status='rejected' where plan_id=$1 and status='open'`, [planId]);
      for (const m of members) {
        await logEvent(q, { userId: m.user_id, squadId: plan.squad_id, actor: "kitten", type: "plan.cancelled", objectType: "plan", objectId: planId, payload: { text: `"${plan.title}" was cancelled. Anything I held for you is released.` }, reason: "the host cancelled the plan" });
      }
      await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "plan.cancelled", objectType: "plan", objectId: planId, public: { text: `${plan.title} was cancelled. Everything held has been released.` } });
    });
    return { ok: true, released: paws.length };
  });
}

// ---------------------------------------------------------------- tag along: after the Pounce, with the host's yes (FR-POUNCE-9, FR-POUNCE-14..17)

type TagRequest = { id: string; plan_id: string; user_id: string; status: "asked" | "approved" | "declined" | "done" | "expired"; held_jar?: number; held_savings?: number };

/** The way in for someone who isn't in. Before the Pounce they're simply added. After it, they ask the host. */
export async function tagAlong(userId: string, planId: string, opts: { refill?: boolean } = {}) {
  // Two people at once would both refund the same people: one at a time per plan.
  return withLock(`pounce:${planId}`, async () => {
    const plan = await getPlan(await db(), planId);
    if (plan.status === "open") return joinOpen(userId, plan, opts.refill);
    return askToTagAlong(userId, plan, opts.refill);
  });
}

/** Can this person still come along? Refuses with the reason if not. */
async function checkTagAlong(q: Queryable, plan: PlanRow, userId: string) {
  if (!["pounced", "settled"].includes(plan.status)) throw new Error("This plan can't take anyone new now.");
  if (plan.starts_at && new Date(plan.starts_at).getTime() <= Date.now()) throw new Error("This plan has already started.");
  const [pounce] = await q.query<{ group_ids: string[] }>(`select group_ids from pounces where plan_id=$1 order by created_at desc limit 1`, [plan.id]);
  if (pounce.group_ids.includes(userId)) throw new Error("You're already in.");
  const inSquad = await q.query(`select 1 from memberships where squad_id=$1 and user_id=$2 and left_at is null`, [plan.squad_id, userId]);
  if (!inSquad.length) throw new Error("You're not in this plan's group.");
  const owed = await q.query(`select 1 from plan_members where plan_id=$1 and overrun_due_cents>0 and not overrun_paid limit 1`, [plan.id]);
  if (owed.length) throw new Error("The extra cost is still being collected. Try again once that's done.");
  const cal = await calendar(q, userId, plan.id);
  const busy = clash(windowOf(plan.starts_at, plan.ends_at), cal.plansIn, []);
  if (busy.hard) throw new Error(`You're already in ${cal.plansIn.find((p) => p.planId === busy.hard!.planId)?.title ?? "another plan"} then.`);
}

/** What a tag-along comes to right now: their share, everyone's new share, and what each person gets back. */
async function tagMath(q: Queryable, plan: PlanRow, userId: string) {
  const [pounce] = await q.query<{ id: string; group_ids: string[]; shares: Record<string, number> }>(`select id, group_ids, shares from pounces where plan_id=$1 order by created_at desc limit 1`, [plan.id]);
  // The receipt's total if there is one, and what each person has actually paid, net of refunds.
  const [rcpt] = await q.query<{ confirmed_cents: number }>(`select confirmed_cents from receipts where plan_id=$1 and status='confirmed' order by created_at desc limit 1`, [plan.id]);
  const cost = rcpt && plan.price_mode === "total" ? { ...costOf(plan), priceCents: rcpt.confirmed_cents } : costOf(plan);
  const existing = [];
  for (const [i, id] of pounce.group_ids.entries()) {
    const net = (await paidParts(q, plan.id, id)).reduce((a, p) => a + p.cents, 0);
    existing.push({ id, order: i + 1, paidCents: net || pounce.shares[id] });
  }
  return { pounce, ...tagAlongMath(cost, existing, { id: userId, order: existing.length + 1 }) };
}

/** How much more their Treat Jar needs for this share (their own savings first, if the host chose them). */
async function jarShortFor(plan: PlanRow, userId: string, cents: number) {
  const d = await db();
  const savings = plan.use_savings ? Math.min(await savingsBalance(d, plan.squad_id, userId), cents) : 0;
  return Math.max(0, cents - savings - (await jarBalances(d, userId)).availableCents);
}

/** What tagging along would cost this person now, and how much of it has to come from their Treat Jar. */
export async function tagQuote(q: Queryable, planId: string, userId: string) {
  const plan = await getPlan(q, planId);
  const { newcomerPays } = await tagMath(q, plan, userId);
  const savings = plan.use_savings ? Math.min(await savingsBalance(q, plan.squad_id, userId), newcomerPays) : 0;
  return { cents: newcomerPays, jarCents: newcomerPays - savings };
}

/** What the plan page needs: requests waiting on this host, this person's own request, and whether they can ask. */
export async function tagView(q: Queryable, plan: PlanRow, viewerId: string) {
  const asks = plan.host_id === viewerId ? await q.query<{ id: string; name: string }>(`select r.id, u.name from tag_requests r join users u on u.id=r.user_id where r.plan_id=$1 and r.status='asked' order by r.created_at`, [plan.id]) : [];
  const [request] = await q.query<{ id: string; status: string }>(`select id, status from tag_requests where plan_id=$1 and user_id=$2`, [plan.id, viewerId]);
  const joining = (await q.query<{ user_id: string }>(`select user_id from tag_requests where plan_id=$1 and status='approved'`, [plan.id])).map((x) => x.user_id);
  if (!["pounced", "settled"].includes(plan.status)) return { asks, request: request ?? null, canAsk: false, quoteCents: null, joining };
  const possible = await checkTagAlong(q, plan, viewerId).then(
    () => true,
    () => false,
  );
  return { asks, request: request ?? null, canAsk: possible && !request, quoteCents: possible ? (await tagMath(q, plan, viewerId)).newcomerPays : null, joining };
}

async function askToTagAlong(userId: string, plan: PlanRow, refill?: boolean) {
  const d = await db();
  const hostName = (await getUser(d, plan.host_id))?.name ?? "The host";
  const [old] = await d.query<TagRequest>(`select * from tag_requests where plan_id=$1 and user_id=$2`, [plan.id, userId]);
  if (old?.status === "asked") return { ok: true as const, status: "asked", message: `I've already asked ${hostName}. I'll tell you what they say.` };
  if (old?.status === "declined") throw new Error(`${hostName} said no to this one.`);
  if (old?.status === "done") throw new Error("You're already in.");
  if (old?.status === "approved") return payApprovedTag(plan, old, refill);
  await checkTagAlong(d, plan, userId);
  const { newcomerPays } = await tagMath(d, plan, userId);
  // Asking is agreeing to pay (FR-JAR-8): the share is set aside now, so the host's yes is all it takes.
  const savingsSquad = plan.use_savings ? plan.squad_id : null;
  const s = await shortOf(userId, newcomerPays, savingsSquad);
  if (s.shortCents > 0) return refillOrAsk(userId, s.shortCents, s.jarCents, { refill, after: `tagask:${plan.id}`, reason: `your share of ${plan.title}` });
  await d.tx(async (q) => {
    const held = await setAside(q, userId, newcomerPays, savingsSquad, `tagging along on ${plan.title}`);
    await q.query(
      `insert into tag_requests (plan_id, user_id, held_jar, held_savings) values ($1,$2,$3,$4)
       on conflict (plan_id, user_id) do update set status='asked', held_jar=excluded.held_jar, held_savings=excluded.held_savings, created_at=now(), decided_at=null`,
      [plan.id, userId, held.jarCents, held.savingsCents],
    );
    await logEvent(q, { userId, squadId: plan.squad_id, actor: "kitten", type: "tag.asked", objectType: "plan", objectId: plan.id, payload: { cents: newcomerPays, text: `I asked ${hostName} if you can tag along on "${plan.title}". Your ${fmt(newcomerPays)} is set aside, so you're in the moment they say yes. If they say no, it comes straight back.` }, reason: "you asked to tag along" });
  });
  return { ok: true as const, status: "asked", message: `I asked ${hostName}. Your ${fmt(newcomerPays)} is set aside, so you're in the moment they say yes.` };
}

/** The host answers. No is just no. Yes takes the money straight away, or waits for a refill if the jar is short. */
export async function answerTagRequest(hostId: string, requestId: string, accept: boolean) {
  const d = await db();
  const [r0] = await d.query<{ plan_id: string }>(`select plan_id from tag_requests where id=$1`, [requestId]);
  if (!r0) throw new Error("That request isn't here any more.");
  return withLock(`pounce:${r0.plan_id}`, async () => {
    const [r] = await d.query<TagRequest>(`select * from tag_requests where id=$1`, [requestId]);
    const plan = await getPlan(d, r.plan_id);
    if (plan.host_id !== hostId) throw new Error("Only the host can answer this.");
    if (r.status !== "asked") throw new Error("That's already been answered.");
    const [host, asker] = await Promise.all([getUser(d, hostId), getUser(d, r.user_id)]);
    const hostName = host?.name ?? "The host";
    const askerName = asker?.name ?? "them";
    if (!accept) {
      await d.tx(async (q) => {
        await giveBack(q, r.user_id, { jarCents: r.held_jar ?? 0, savingsCents: r.held_savings ?? 0 }, plan.squad_id, "the host said no");
        await q.query(`update tag_requests set status='declined', decided_at=now(), held_jar=0, held_savings=0 where id=$1`, [r.id]);
        await logEvent(q, { userId: r.user_id, squadId: plan.squad_id, actor: "kitten", type: "tag.declined", objectType: "plan", objectId: plan.id, payload: { text: `${hostName} said no to you tagging along on "${plan.title}".${(r.held_jar ?? 0) + (r.held_savings ?? 0) ? ` Your ${fmt((r.held_jar ?? 0) + (r.held_savings ?? 0))} is back in your Treat Jar.` : ""}` }, reason: "the host answered" });
      });
      return { ok: true as const, paid: false, message: `I told ${askerName} no.` };
    }
    await checkTagAlong(d, plan, r.user_id);
    await d.query(`update tag_requests set status='approved', decided_at=now() where id=$1`, [r.id]);
    const out = await payApprovedTag(plan, { ...r, status: "approved" });
    if ("paid" in out) return { ...out, message: `${askerName} is in. Everyone's share is updated.` };
    // Their jar is short. Only they can approve a refill, so a card asks them, and it finishes itself when the money lands.
    // Until then everyone hears what's happening, so nobody wonders why the shares haven't moved yet.
    const math = await tagMath(d, plan, r.user_id);
    const short = await jarShortFor(plan, r.user_id, math.newcomerPays);
    await d.tx(async (q) => {
      await logEvent(q, { userId: r.user_id, squadId: plan.squad_id, actor: "kitten", type: "tag.approved", objectType: "plan", objectId: plan.id, payload: { cents: math.newcomerPays, text: `${hostName} said yes to you tagging along on "${plan.title}". Refill your Treat Jar with ${fmt(short)} and you're in. Your share is ${fmt(math.newcomerPays)}.` }, reason: "the host said yes" });
      await logEvent(q, { userId: hostId, squadId: plan.squad_id, actor: "kitten", type: "tag.waiting", objectType: "plan", objectId: plan.id, payload: { text: `You said yes to ${askerName} on "${plan.title}". They're in as soon as their Treat Jar has ${fmt(math.newcomerPays)}. Then everyone's share drops, and the difference goes back.` }, reason: "you said yes" });
      for (const uid of math.pounce.group_ids.filter((id) => id !== hostId)) {
        await logEvent(q, { userId: uid, squadId: plan.squad_id, actor: "kitten", type: "tag.joining", objectType: "plan", objectId: plan.id, payload: { text: `${askerName} is joining "${plan.title}". Your share drops to ${fmt(math.newShares[uid])} as soon as their money is in.` }, reason: "the host said yes to someone tagging along" });
      }
    });
    return { ok: true as const, paid: false, message: `Yes sent. ${askerName} is in as soon as they refill their Treat Jar. Everyone's share drops then.` };
  });
}

/** The person who was told yes puts their money in (or comes back with a refill). */
export async function payTagRequest(userId: string, requestId: string, refill?: boolean) {
  const d = await db();
  const [r0] = await d.query<{ plan_id: string; user_id: string }>(`select plan_id, user_id from tag_requests where id=$1`, [requestId]);
  if (!r0 || r0.user_id !== userId) throw new Error("That request isn't here any more.");
  return withLock(`pounce:${r0.plan_id}`, async () => {
    const [r] = await d.query<TagRequest>(`select * from tag_requests where id=$1`, [requestId]);
    if (r.status === "done") return { ok: true as const, paid: true as const, already: true };
    if (r.status !== "approved") throw new Error("The host hasn't said yes to this.");
    return payApprovedTag(await getPlan(d, r.plan_id), r, refill);
  });
}

/** Tick: an ask the host never answered before the plan started (or the plan ended) gives the money back. */
export async function expireTagRequests(now = new Date()) {
  const d = await db();
  const stale = await d.query<{ id: string; user_id: string; squad_id: string; title: string; held_jar: number; held_savings: number }>(
    `select r.id, r.user_id, p.squad_id, p.title, r.held_jar, r.held_savings from tag_requests r join plans p on p.id=r.plan_id
     where r.status in ('asked','approved') and ((p.starts_at is not null and p.starts_at <= $1) or p.status not in ('pounced','settled'))`,
    [now.toISOString()],
  );
  for (const r of stale) {
    await d.tx(async (q) => {
      await giveBack(q, r.user_id, { jarCents: r.held_jar, savingsCents: r.held_savings }, r.squad_id, "the plan went ahead without an answer");
      await q.query(`update tag_requests set status='expired', held_jar=0, held_savings=0 where id=$1`, [r.id]);
      await logEvent(q, { userId: r.user_id, squadId: r.squad_id, actor: "kitten", type: "tag.expired", objectType: "plan", payload: { text: `"${r.title}" started before the host answered.${r.held_jar + r.held_savings ? ` Your ${fmt(r.held_jar + r.held_savings)} is back in your Treat Jar.` : ""}` }, reason: "the plan started" });
    });
  }
  return stale.length;
}

/** Money just landed in this person's jar: a tag-along the host already said yes to goes through. */
export async function tagWaiting(userId: string) {
  const d = await db();
  const waiting = await d.query<{ id: string }>(`select id from tag_requests where user_id=$1 and status='approved'`, [userId]);
  for (const r of waiting) await payTagRequest(userId, r.id).catch((e) => console.error(`[plan] tag along after top-up: ${(e as Error).message}`));
}

/**
 * The host said yes, so the money moves, all in one transaction so it can never stop halfway:
 * the newcomer's share goes to the booker's Treat Jar (where the pot went), and out of it each person already in gets
 * back the difference. The booker's own difference simply stays in their jar. Callers hold the plan's lock.
 */
async function payApprovedTag(plan: PlanRow, r: TagRequest, refill?: boolean): Promise<JarShort | Refill | { ok: true; paid: true; newcomerPays: number; refunds: Record<string, number> }> {
  const d = await db();
  const userId = r.user_id;
  await checkTagAlong(d, plan, userId);
  // What they set aside when they asked goes back into their jar and savings first, and is spent from there just below.
  const [held] = await d.query<{ held_jar: number; held_savings: number }>(`select held_jar, held_savings from tag_requests where id=$1`, [r.id]);
  if (held && held.held_jar + held.held_savings > 0) {
    await d.tx(async (q) => {
      await giveBack(q, userId, { jarCents: held.held_jar, savingsCents: held.held_savings }, plan.squad_id, `moving your set-aside money into ${plan.title}`);
      await q.query(`update tag_requests set held_jar=0, held_savings=0 where id=$1`, [r.id]);
    });
  }
  const math = await tagMath(d, plan, userId);
  const [asker, booker] = await Promise.all([getUser(d, userId), getUser(d, plan.booker_id)]);
  const savings = plan.use_savings ? Math.min(await savingsBalance(d, plan.squad_id, userId), math.newcomerPays) : 0;
  const fromJar = math.newcomerPays - savings;
  let { availableCents } = await jarBalances(d, userId);
  if (availableCents < fromJar && asker?.is_demo) {
    // Demo friends can't approve a refill, so the sandbox test card fills the jar for them.
    const short = fromJar - availableCents;
    const pay = await testCardPayment({ cents: short, customId: `jar:${userId}` });
    await d.tx((q) => move(q, acct.world, acct.jar(userId), short, { kind: "jar_topup", userId, paypalId: pay.captureId, reason: "Treat Jar top-up" }));
    availableCents += short;
  }
  if (availableCents < fromJar) return refillOrAsk(userId, fromJar - availableCents, availableCents, { refill, after: `tag:${r.id}`, reason: `your share of ${plan.title}` });

  const askerName = asker?.name ?? "Someone";
  const bookerName = booker?.name ?? "the booker";
  const parts: Paid[] = [];
  for (const [uid, cents] of Object.entries(math.refunds)) {
    const paid = await paidParts(d, plan.id, uid);
    parts.push(...(paid.length ? leftovers(paid, cents) : [{ userId: uid, source: "jar" as const, cents }]));
  }
  const toOthers = Object.entries(math.refunds).filter(([id]) => id !== plan.booker_id);
  const backTotal = toOthers.reduce((a, [, c]) => a + c, 0);

  await d.tx(async (q) => {
    if (savings > 0) await move(q, acct.savings(plan.squad_id, userId), acct.plan(plan.id), savings, { kind: "savings_spend", userId, planId: plan.id, reason: `tagging along on ${plan.title}` });
    if (fromJar > 0) await move(q, acct.jar(userId), acct.plan(plan.id), fromJar, { kind: "jar_spend", userId, planId: plan.id, reason: `tagging along on ${plan.title}` });
    await move(q, acct.plan(plan.id), acct.jar(plan.booker_id), math.newcomerPays, { kind: "tag_along_in", userId: plan.booker_id, planId: plan.id, reason: `${askerName} tagged along on ${plan.title}` });
    for (const part of parts) {
      if (part.userId === plan.booker_id) {
        // The booker's own share came down too. It's already in their jar, so this only keeps their month right.
        await move(q, acct.world, acct.plan(plan.id), part.cents, { kind: "tag_along_kept", userId: part.userId, planId: plan.id, reason: "your share came down (it stays in your Treat Jar)" });
        await move(q, acct.plan(plan.id), acct.world, part.cents, { kind: "refund", userId: part.userId, planId: plan.id, reason: `${askerName} tagged along, so your share dropped` });
      } else {
        await move(q, acct.jar(plan.booker_id), acct.plan(plan.id), part.cents, { kind: "tag_along_return", userId: plan.booker_id, planId: plan.id, reason: `giving back the difference on ${plan.title}` });
        await move(q, acct.plan(plan.id), part.source === "savings" ? acct.savings(plan.squad_id, part.userId) : acct.jar(part.userId), part.cents, { kind: "refund", userId: part.userId, planId: plan.id, reason: `${askerName} tagged along, so your share dropped` });
      }
      await q.query(`insert into refunds (plan_id, user_id, cents, source, reason) values ($1,$2,$3,$4,$5)`, [plan.id, part.userId, part.cents, part.source, part.userId === plan.booker_id ? "tag_along_kept" : "tag_along"]);
    }
    await q.query(`insert into plan_members (plan_id, user_id, status, joined_at) values ($1,$2,'in',now()) on conflict (plan_id,user_id) do update set status='in', joined_at=coalesce(plan_members.joined_at, now())`, [plan.id, userId]);
    for (const [uid, c] of Object.entries(math.newShares)) await q.query(`update plan_members set limit_cents=$3 where plan_id=$1 and user_id=$2`, [plan.id, uid, c]);
    await q.query(`update pounces set group_ids=$2, shares=$3, total_cents=total_cents+$4 where id=$1`, [math.pounce.id, [...math.pounce.group_ids, userId], JSON.stringify(math.newShares), plan.price_mode === "per_person" ? math.newcomerPays : 0]);
    await q.query(`update tag_requests set status='done' where id=$1`, [r.id]);

    await logEvent(q, { userId, squadId: plan.squad_id, actor: "kitten", type: "tag_along.paid", objectType: "plan", objectId: plan.id, payload: { cents: math.newcomerPays, text: `You're in "${plan.title}". Your ${fmt(math.newcomerPays)} went to ${bookerName}'s Treat Jar.` }, reason: "the host said yes" });
    await logEvent(q, { userId: plan.booker_id, squadId: plan.squad_id, actor: "system", type: "tag_along.received", objectType: "plan", objectId: plan.id, payload: { cents: math.newcomerPays, text: `${askerName} tagged along on "${plan.title}". ${fmt(math.newcomerPays)} came into your Treat Jar${backTotal ? `, and ${fmt(backTotal)} of it went back to the others` : ""}. Your share is now ${fmt(math.newShares[plan.booker_id])}.` } });
    for (const uid of math.pounce.group_ids.filter((id) => id !== plan.booker_id)) {
      const cents = math.refunds[uid] ?? 0;
      const where = parts.some((x) => x.userId === uid && x.source === "savings") ? "you" : "your Treat Jar";
      await logEvent(q, { userId: uid, squadId: plan.squad_id, actor: "system", type: cents ? "tag_along.refund" : "tag_along.joined", objectType: "plan", objectId: plan.id, payload: { cents, text: cents ? `${askerName} tagged along on "${plan.title}", so your share is now ${fmt(math.newShares[uid])}. ${fmt(cents)} came back to ${where}.` : `${askerName} tagged along on "${plan.title}". Your share stays ${fmt(math.newShares[uid])}.` } });
    }
    await logEvent(q, { squadId: plan.squad_id, actor: "system", type: "tag_along", objectType: "plan", objectId: plan.id, public: { text: `${askerName} tagged along on ${plan.title}.${Object.keys(math.refunds).length ? " Everyone's share just dropped." : ""}` } });
  });
  return { ok: true, paid: true, newcomerPays: math.newcomerPays, refunds: math.refunds };
}

/** What a member has paid into a plan, NET of refunds so far, by source (ledger + refunds). */
export async function paidParts(q: Queryable, planId: string, userId: string): Promise<Paid[]> {
  const rows = await q.query<{ kind: string; c: string }>(
    `select kind, sum(amount_cents) as c from ledger where plan_id=$1 and user_id=$2 and account=$3
       and kind in ('capture','jar_spend','savings_spend','tag_along','overrun') and amount_cents > 0 group by kind`,
    [planId, userId, acct.plan(planId)],
  );
  const src = (k: string) => (k === "capture" || k === "tag_along" ? "paypal" : k === "jar_spend" || k === "overrun" ? "jar" : "savings") as Paid["source"];
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
