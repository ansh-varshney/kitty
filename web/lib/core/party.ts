import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, balance, move } from "./ledger";
import { getUser, isMember } from "./users";
import { payOut } from "./money-flow";
import { baseUrl } from "../env";
import { testCardPayment } from "../paypal/holds";
import { createProduct, createQuantityPlan, createSubscription } from "../paypal/subscriptions";
import { paypalRequest } from "../paypal/rest";
import { withLock } from "./locks";

/**
 * Kitty Party: a squad's shared savings (PRD §B13, FR-PARTY-1..6, AT-24). One party per squad. Each member saves
 * their OWN monthly amount through a PayPal subscription ($1 unit price × quantity = their dollars). Every member's
 * balance is tracked separately in the ledger (savings:{squad}:{user}); the jar total is always the sum of them.
 * Demo friends can't approve subscriptions, so their monthly saving is a sandbox test-card payment each cycle.
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

type PartyRow = { id: string; squad_id: string; name: string; goal_cents: number | null; goal_note: string | null; interval_unit: string; paypal_plan_id: string | null };

async function partyBySquad(q: Queryable, squadId: string) {
  const [p] = await q.query<PartyRow>(`select * from parties where squad_id=$1`, [squadId]);
  return p ?? null;
}

export async function createParty(userId: string, squadId: string, input: { name: string; goalCents?: number | null; goalNote?: string | null; intervalUnit?: "DAY" | "WEEK" | "MONTH" }) {
  const d = await db();
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  if (await partyBySquad(d, squadId)) throw new Error("This squad already has a Kitty Party.");
  const interval = input.intervalUnit ?? "MONTH";
  // One PayPal billing plan per party: $1 unit price, quantity = each member's monthly dollars (§B13 under the hood).
  let productId: string | null = null;
  let planId: string | null = null;
  try {
    productId = await createProduct(`Kitty Party: ${input.name}`.slice(0, 120), "Saving together with friends");
    planId = (await createQuantityPlan({ productId, name: `${input.name} savings`.slice(0, 120), intervalUnit: interval })).planId;
  } catch (e) {
    console.error(`[party] PayPal plan not created yet: ${(e as Error).message}`);
  }
  const [p] = await d.query<{ id: string }>(
    `insert into parties (squad_id, name, goal_cents, goal_note, interval_unit, paypal_product_id, paypal_plan_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [squadId, input.name.slice(0, 40), input.goalCents ?? null, input.goalNote ?? null, interval, productId, planId, userId],
  );
  await logEvent(d, { squadId, actor: "user", actorId: userId, type: "party.created", objectType: "party", objectId: p.id, public: { text: `A Kitty Party started: ${input.name}${input.goalCents ? ` (goal ${fmt(input.goalCents)})` : ""}. Join with your own monthly amount.` } });
  return { partyId: p.id, paypalPlanId: planId };
}

/** Join (or change) with my own monthly amount (FR-PARTY-1, rule R6). */
export async function joinParty(userId: string, squadId: string, monthlyCents: number) {
  const d = await db();
  const party = await partyBySquad(d, squadId);
  if (!party) throw new Error("This squad has no Kitty Party yet.");
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  if (!Number.isInteger(monthlyCents) || monthlyCents < 100 || monthlyCents % 100 !== 0) throw new Error("Pick whole dollars, at least $1.");
  return withLock(`party:${party.id}:${userId}`, () => joinPartyNow(userId, squadId, party, monthlyCents));
}

async function joinPartyNow(userId: string, squadId: string, party: PartyRow, monthlyCents: number) {
  const d = await db();
  const user = await getUser(d, userId);
  await d.query(`delete from rules where user_id=$1 and squad_id=$2 and type='R6'`, [userId, squadId]);
  await d.query(`insert into rules (user_id, squad_id, type, params, text) values ($1,$2,'R6',$3,$4)`, [userId, squadId, JSON.stringify({ cents: monthlyCents, partyId: party.id }), `Save ${fmt(monthlyCents)} a ${party.interval_unit.toLowerCase()} into ${party.name}`]);
  const [was] = await d.query<{ status: string; subscription_id: string | null; due: boolean }>(
    `select status, subscription_id, (last_collected_at is null or last_collected_at < now() - (case $3 when 'DAY' then interval '1 day' when 'WEEK' then interval '7 days' else interval '30 days' end)) as due
     from party_members where party_id=$1 and user_id=$2`,
    [party.id, userId, party.interval_unit],
  );

  if (user?.is_demo) {
    await d.query(
      `insert into party_members (party_id, user_id, monthly_cents, status) values ($1,$2,$3,'active')
       on conflict (party_id, user_id) do update set monthly_cents=excluded.monthly_cents, status='active'`,
      [party.id, userId, monthlyCents],
    );
    // Changing the amount (or re-joining within the same month) isn't a new saving: the next cycle uses the new amount.
    if (was && !was.due) return { ok: true, status: "active", changed: was.status === "active", nextSavingCents: monthlyCents };
    const first = await collectContribution(party.id, userId);
    return { ok: true, status: "active", firstContribution: first };
  }
  if (was?.status === "active" && was.subscription_id) {
    // A real saver changing their amount: revise the same PayPal subscription's quantity (§C3), never a second one.
    const rev = await paypalRequest<{ links?: { rel: string; href: string }[] }>("POST", `/v1/billing/subscriptions/${was.subscription_id}/revise`, { body: { quantity: String(monthlyCents / 100) } });
    await d.query(`update party_members set monthly_cents=$3 where party_id=$1 and user_id=$2`, [party.id, userId, monthlyCents]);
    const approve = rev.links?.find((l) => l.rel === "approve")?.href;
    return { ok: true, status: "active", changed: true, approveUrl: approve };
  }
  if (!party.paypal_plan_id) throw new Error("The party's PayPal plan isn't ready yet. Try again in a minute.");
  const base = baseUrl();
  const sub = await createSubscription({ planId: party.paypal_plan_id, quantity: monthlyCents / 100, customId: `party:${party.id}:${userId}`, returnUrl: `${base}/api/v1/return/party`, cancelUrl: `${base}/?cancelled=party` });
  await d.query(
    `insert into party_members (party_id, user_id, monthly_cents, subscription_id, approve_url, status) values ($1,$2,$3,$4,$5,'pending')
     on conflict (party_id, user_id) do update set monthly_cents=excluded.monthly_cents, subscription_id=excluded.subscription_id, approve_url=excluded.approve_url, status='pending'`,
    [party.id, userId, monthlyCents, sub.subscriptionId, sub.approveUrl],
  );
  return { ok: true, status: "pending", approveUrl: sub.approveUrl };
}

async function creditSaving(q: Queryable, party: PartyRow, userId: string, cents: number, paypalId: string | null) {
  if (paypalId) {
    const seen = await q.query(`select 1 from ledger where paypal_id=$1 and kind='savings_contribution' limit 1`, [paypalId]);
    if (seen.length) return false; // idempotent: a webhook delivered twice credits once
  }
  await move(q, acct.world, acct.savings(party.squad_id, userId), cents, { kind: "savings_contribution", userId, paypalId, reason: `${party.name} saving` });
  await q.query(`update party_members set collected_count=collected_count+1, last_collected_at=now() where party_id=$1 and user_id=$2`, [party.id, userId]);
  const mine = await balance(q, acct.savings(party.squad_id, userId));
  const jar = await jarTotal(q, party.squad_id);
  await logEvent(q, { userId, squadId: party.squad_id, actor: "system", type: "party.saved", objectType: "party", objectId: party.id, payload: { cents, balanceCents: mine, text: `Saved ${fmt(cents)} into ${party.name}. Your savings: ${fmt(mine)}.` }, paypalId });
  await logEvent(q, { squadId: party.squad_id, actor: "system", type: "party.jar", objectType: "party", objectId: party.id, public: { text: `${party.name} jar: ${fmt(jar)}${party.goal_cents ? ` of ${fmt(party.goal_cents)}` : ""}.`, jarCents: jar, goalCents: party.goal_cents } });
  return true;
}

/** One cycle's saving for a demo member (sandbox test card). Real members are credited by the PayPal webhook. */
export async function collectContribution(partyId: string, userId: string) {
  const d = await db();
  const [party] = await d.query<PartyRow>(`select * from parties where id=$1`, [partyId]);
  const [m] = await d.query<{ monthly_cents: number; status: string }>(`select monthly_cents, status from party_members where party_id=$1 and user_id=$2`, [partyId, userId]);
  if (!party || !m || m.status !== "active") throw new Error("Not an active saver.");
  const pay = await testCardPayment({ cents: m.monthly_cents, customId: `party:${partyId.slice(0, 8)}:${userId.slice(0, 8)}` });
  await d.tx((q) => creditSaving(q, party, userId, m.monthly_cents, pay.captureId ?? null));
  return { cents: m.monthly_cents, paypalId: pay.captureId };
}

/** PayPal webhook PAYMENT.SALE.COMPLETED for a party subscription → credit that member (§B13 under the hood). */
export async function creditFromWebhook(subscriptionId: string, cents: number, saleId: string) {
  const d = await db();
  const [m] = await d.query<{ party_id: string; user_id: string }>(`select party_id, user_id from party_members where subscription_id=$1`, [subscriptionId]);
  if (!m) return false;
  const [party] = await d.query<PartyRow>(`select * from parties where id=$1`, [m.party_id]);
  await d.query(`update party_members set status='active' where party_id=$1 and user_id=$2 and status='pending'`, [m.party_id, m.user_id]);
  return d.tx((q) => creditSaving(q, party, m.user_id, cents, saleId));
}

/** Back from PayPal after approving the subscription. */
export async function finishPartySubscription(subscriptionId: string) {
  const d = await db();
  const r = await d.query<{ party_id: string }>(`update party_members set status='active' where subscription_id=$1 returning party_id`, [subscriptionId]);
  return { ok: r.length > 0 };
}

export async function jarTotal(q: Queryable, squadId: string) {
  const [r] = await q.query<{ c: string | null }>(
    `select coalesce(sum(amount_cents),0) as c from ledger where account like $1 or account like $2`,
    [`savings:${squadId}:%`, `savings_held:${squadId}:%`],
  );
  return Number(r.c ?? 0);
}

/** Each member's own balance (savings + reserved for a plan), FR-PARTY-6. */
export async function memberBalances(q: Queryable, squadId: string) {
  const rows = await q.query<{ account: string; c: string }>(
    `select account, sum(amount_cents) as c from ledger where account like $1 or account like $2 group by account`,
    [`savings:${squadId}:%`, `savings_held:${squadId}:%`],
  );
  const by: Record<string, number> = {};
  for (const r of rows) {
    const userId = r.account.split(":").pop()!;
    by[userId] = (by[userId] ?? 0) + Number(r.c);
  }
  return by;
}

/** The party as one member sees it: one shared jar and goal; only their OWN balance (FR-PARTY-2). */
export async function partyView(userId: string, squadId: string) {
  const d = await db();
  if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
  const party = await partyBySquad(d, squadId);
  if (!party) return { party: null };
  const jar = await jarTotal(d, squadId);
  const members = await d.query<{ name: string; status: string }>(`select u.name, m.status from party_members m join users u on u.id=m.user_id where m.party_id=$1 order by m.joined_at`, [party.id]);
  const [mine] = await d.query<{ monthly_cents: number; status: string; collected_count: number; approve_url: string | null }>(`select monthly_cents, status, collected_count, approve_url from party_members where party_id=$1 and user_id=$2`, [party.id, userId]);
  return {
    party: { id: party.id, name: party.name, goalCents: party.goal_cents, goalNote: party.goal_note, interval: party.interval_unit },
    jarCents: jar,
    goalPct: party.goal_cents ? Math.min(100, Math.round((jar / party.goal_cents) * 100)) : null,
    savers: members.filter((m) => m.status === "active").map((m) => m.name),
    mine: mine ? { ...mine, balanceCents: (await memberBalances(d, squadId))[userId] ?? 0 } : null,
  };
}

/** Take my own savings back (FR-PARTY-4). */
export async function withdrawSavings(userId: string, squadId: string, cents?: number) {
  // One at a time per person: a double tap must not pay out twice (the ledger also refuses to go below $0).
  return withLock(`savings:${squadId}:${userId}`, () => withdrawSavingsNow(userId, squadId, cents));
}

async function withdrawSavingsNow(userId: string, squadId: string, cents?: number) {
  const d = await db();
  const available = await balance(d, acct.savings(squadId, userId));
  const amount = cents ?? available;
  if (!Number.isInteger(amount) || amount <= 0 || amount > available) throw new Error(`You can withdraw up to ${fmt(available)}.`);
  const batch = await d.tx((q) => payOut(q, userId, amount, acct.savings(squadId, userId), { note: "Kitty Party savings withdrawal", itemId: `save-${userId.slice(0, 8)}`, kind: "savings_withdraw" }));
  if (!batch) throw new Error("PayPal couldn't send the money just now. Try again soon.");
  await logEvent(d, { userId, squadId, actor: "user", actorId: userId, type: "party.withdrawn", payload: { cents: amount, text: `${fmt(amount)} of your savings is on its way to your PayPal.` }, paypalId: batch });
  return { ok: true, cents: amount, payoutBatchId: batch };
}

/** Stop (or pause) my monthly saving; my balance stays mine (FR-PARTY-4). */
export async function stopSaving(userId: string, squadId: string) {
  const d = await db();
  const party = await partyBySquad(d, squadId);
  if (!party) throw new Error("No Kitty Party here.");
  const [m] = await d.query<{ subscription_id: string | null }>(`update party_members set status='stopped' where party_id=$1 and user_id=$2 returning subscription_id`, [party.id, userId]);
  if (m?.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${m.subscription_id}/cancel`, { body: { reason: "Stopped saving in Kitty" } }).catch(() => undefined);
  await d.query(`update rules set active=false where user_id=$1 and squad_id=$2 and type='R6'`, [userId, squadId]);
  return { ok: true };
}

/** Job: collect due savings for demo savers (real savers are billed by PayPal). */
export async function partyJobs(now = new Date()) {
  const d = await db();
  const due = await d.query<{ party_id: string; user_id: string }>(
    `select m.party_id, m.user_id from party_members m join parties p on p.id=m.party_id join users u on u.id=m.user_id
     where m.status='active' and u.is_demo and (m.last_collected_at is null or m.last_collected_at <
       $1::timestamptz - (case p.interval_unit when 'DAY' then interval '1 day' when 'WEEK' then interval '7 days' else interval '30 days' end))`,
    [now.toISOString()],
  );
  let collected = 0;
  for (const m of due) {
    try {
      await collectContribution(m.party_id, m.user_id);
      collected++;
    } catch (e) {
      console.error(`[party] collection failed: ${(e as Error).message}`);
    }
  }
  return { collected };
}
