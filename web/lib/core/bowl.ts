import { db } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { getUser, isMember } from "./users";
import { payOut } from "./money-flow";
import { splitCents } from "../referee/shares";
import { baseUrl } from "../env";
import { testCardPayment } from "../paypal/holds";
import { createProduct, createQuantityPlan, createSubscription } from "../paypal/subscriptions";
import { paypalRequest } from "../paypal/rest";
import { withLock } from "./locks";

/**
 * The Bowl: shared subscriptions (PRD §B15, FR-BOWL-1..3). One person pays the provider; each other member's share
 * is a PayPal subscription; each cycle the collected shares go to the account holder in ONE Payout. A missed share
 * becomes a private reminder and a Yarn strand. Demo friends pay their share with the sandbox test card.
 * Real members subscribe to a per-Bowl plan priced $0.01 × quantity = their share in cents (exact, no rounding).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export async function createBowl(ownerId: string, input: { squadId: string; service: string; totalCents: number; seats: number; memberIds: string[] }) {
  const d = await db();
  if (!(await isMember(d, input.squadId, ownerId))) throw new Error("You're not in that squad.");
  const members = [...new Set(input.memberIds)].filter((m) => m !== ownerId);
  if (!members.length) throw new Error("Add who shares it.");
  if (members.length > input.seats - 1) throw new Error("More people than seats.");
  for (const m of members) if (!(await isMember(d, input.squadId, m))) throw new Error("Everyone must be in the squad.");
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) throw new Error("Pick the monthly total.");
  if (input.totalCents < input.seats * 50) throw new Error(`That's under $0.50 a seat. Check the monthly total.`);
  const shares = splitCents(input.totalCents, Array.from({ length: input.seats }, () => 1));
  const [b] = await d.query<{ id: string }>(`insert into bowls (squad_id, owner_id, service, total_cents, seats) values ($1,$2,$3,$4,$5) returning id`, [input.squadId, ownerId, input.service.slice(0, 40), input.totalCents, input.seats]);
  const owner = await getUser(d, ownerId);
  for (const [i, m] of members.entries()) {
    const share = shares[i + 1];
    await d.query(`insert into bowl_members (bowl_id, user_id, share_cents) values ($1,$2,$3)`, [b.id, m, share]);
    await logEvent(d, { userId: m, squadId: input.squadId, actor: "kitten", type: "bowl.invite", objectType: "bowl", objectId: b.id, payload: { bowlId: b.id, shareCents: share, text: `${owner?.name} set up ${input.service} in the Bowl. Your share: ${fmt(share)} a month, paid automatically. Join?` } });
  }
  await logEvent(d, { squadId: input.squadId, actor: "user", actorId: ownerId, type: "bowl.created", objectType: "bowl", objectId: b.id, public: { text: `${input.service} is in the Bowl now.` } });
  return { bowlId: b.id, shares: Object.fromEntries(members.map((m, i) => [m, shares[i + 1]])), ownerShareCents: shares[0] };
}

/** Join: approve a PayPal subscription for my share (FR-BOWL-2); demo friends are active straight away. */
export async function joinBowl(userId: string, bowlId: string) {
  const d = await db();
  const [m] = await d.query<{ share_cents: number; status: string }>(`select share_cents, status from bowl_members where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
  if (!m) throw new Error("You're not in that Bowl.");
  const [bw] = await d.query<{ status: string }>(`select status from bowls where id=$1`, [bowlId]);
  if (bw?.status !== "active") throw new Error("That Bowl is closed.");
  // Shares were recomputed when you left; coming back at the old share would overcharge the group (edge case G3).
  if (m.status === "left") throw new Error("You left this Bowl. Ask the account holder to add you again.");
  if (m.status === "active") return { ok: true, status: "active" };
  const user = await getUser(d, userId);
  if (user?.is_demo) {
    await d.query(`update bowl_members set status='active' where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
    return { ok: true, status: "active" };
  }
  const [b] = await d.query<{ service: string }>(`select service from bowls where id=$1`, [bowlId]);
  const productId = await createProduct(`Kitty Bowl: ${b.service}`.slice(0, 120), "A shared subscription");
  const { planId } = await createQuantityPlan({ productId, name: `${b.service} share`.slice(0, 120), intervalUnit: "MONTH", unitPriceCents: 1 });
  const base = baseUrl();
  const sub = await createSubscription({ planId, quantity: m.share_cents, customId: `bowl:${bowlId}:${userId}`, returnUrl: `${base}/api/v1/return/party`, cancelUrl: `${base}/?cancelled=bowl` });
  await d.query(`update bowl_members set subscription_id=$3, approve_url=$4 where bowl_id=$1 and user_id=$2`, [bowlId, userId, sub.subscriptionId, sub.approveUrl]);
  return { ok: true, status: "pending", approveUrl: sub.approveUrl };
}

/**
 * One cycle: collect every active share (demo: test card; real: PayPal billed them and the webhook recorded it),
 * pay the account holder in one Payout; a missed share → private reminder + a Yarn strand (FR-BOWL-3).
 */
export async function bowlCycle(bowlId: string, opts: { dueAt?: Date } = {}) {
  // One month at a time per Bowl. The timer passes `dueAt` so a second timer run that queued behind the first sees
  // the month already done and does nothing (edge case G6).
  return withLock(`bowl:${bowlId}`, () => bowlCycleNow(bowlId, opts));
}

async function isDue(bowlId: string, now: Date) {
  const d = await db();
  const r = await d.query(
    `select 1 from bowls b where b.id=$1 and coalesce((select max(created_at) from bowl_cycles c where c.bowl_id=b.id), b.created_at - interval '31 days') < $2::timestamptz - interval '30 days'`,
    [bowlId, now.toISOString()],
  );
  return r.length > 0;
}

async function bowlCycleNow(bowlId: string, opts: { dueAt?: Date }) {
  const d = await db();
  const [b] = await d.query<{ squad_id: string; owner_id: string; service: string }>(`select squad_id, owner_id, service from bowls where id=$1 and status='active'`, [bowlId]);
  if (!b) throw new Error("That Bowl is closed.");
  if (opts.dueAt && !(await isDue(bowlId, opts.dueAt))) return { collectedCents: 0, missed: 0, payoutBatchId: null, skipped: "not due" };
  // Someone invited who never joined (never paid) isn't charged or put in Yarn (edge case G2). Someone whose share
  // changed when a seat left (pending again, but they've paid before) still owes the new share if it isn't paid.
  const members = await d.query<{ user_id: string; share_cents: number; status: string; is_demo: boolean }>(
    `select m.user_id, m.share_cents, m.status, u.is_demo from bowl_members m join users u on u.id=m.user_id
     where m.bowl_id=$1 and (m.status='active' or (m.status='pending' and m.last_paid_at is not null))`,
    [bowlId],
  );
  let collected = 0;
  let missed = 0;
  for (const m of members) {
    let ok = false;
    if (m.status === "active" && m.is_demo) {
      try {
        const pay = await testCardPayment({ cents: m.share_cents, customId: `bowl:${bowlId.slice(0, 8)}:${m.user_id.slice(0, 8)}` });
        await d.tx((q) => move(q, acct.world, acct.bowl(bowlId), m.share_cents, { kind: "bowl_share", userId: m.user_id, paypalId: pay.captureId ?? null, reason: `${b.service} share` }));
        await d.query(`update bowl_members set last_paid_at=now() where bowl_id=$1 and user_id=$2`, [bowlId, m.user_id]);
        await logEvent(d, { userId: m.user_id, squadId: b.squad_id, actor: "system", type: "bowl.paid", objectType: "bowl", objectId: bowlId, payload: { cents: m.share_cents, text: `Paid your ${b.service} share, ${fmt(m.share_cents)}.` }, paypalId: pay.captureId ?? null });
        collected += m.share_cents;
        ok = true;
      } catch (e) {
        console.error(`[bowl] share failed: ${(e as Error).message}`);
      }
    }
    if (!ok) {
      missed++;
      await d.tx(async (q) => {
        const [c] = await q.query<{ id: string }>(`insert into yarn_cards (squad_id, payer_id, created_by, cents, note, kind, status) values ($1,$2,$2,$3,$4,'split','confirmed') returning id`, [b.squad_id, b.owner_id, m.share_cents, `${b.service} share (missed)`]);
        await q.query(`insert into yarn_parts (card_id, user_id, cents, status) values ($1,$2,$3,'confirmed')`, [c.id, m.user_id, m.share_cents]);
        await logEvent(q, { userId: m.user_id, squadId: b.squad_id, actor: "kitten", type: "bowl.missed", objectType: "bowl", objectId: bowlId, payload: { cents: m.share_cents, text: `Your ${b.service} share (${fmt(m.share_cents)}) didn't go through, so I added it to Yarn.` }, reason: "the share wasn't collected this cycle" });
      });
    }
  }
  const batch = collected > 0 ? await d.tx((q) => payOut(q, b.owner_id, collected, acct.bowl(bowlId), { note: `${b.service} shares from the Bowl`, itemId: `bowl-${bowlId.slice(0, 8)}`, kind: "bowl_payout" })) : null;
  await d.query(`insert into bowl_cycles (bowl_id, collected_cents, missed, payout_batch_id) values ($1,$2,$3,$4)`, [bowlId, collected, missed, batch]);
  if (batch) await logEvent(d, { userId: b.owner_id, squadId: b.squad_id, actor: "system", type: "bowl.payout", objectType: "bowl", objectId: bowlId, payload: { cents: collected, text: `${fmt(collected)} in ${b.service} shares is on its way to your PayPal.` }, paypalId: batch });
  return { collectedCents: collected, missed, payoutBatchId: batch };
}

/** A seat leaves: shares are recomputed and the others confirm (FR-BOWL-3). */
export async function leaveBowl(userId: string, bowlId: string) {
  return withLock(`bowl:${bowlId}`, async () => {
    const d = await db();
    const [b] = await d.query<{ squad_id: string; owner_id: string; total_cents: number; seats: number; service: string; status: string }>(`select squad_id, owner_id, total_cents, seats, service, status from bowls where id=$1`, [bowlId]);
    if (b?.owner_id === userId) throw new Error("You hold this Bowl's account. Close the Bowl instead.");
    const [mine] = await d.query<{ subscription_id: string | null }>(`select subscription_id from bowl_members where bowl_id=$1 and user_id=$2 and status <> 'left'`, [bowlId, userId]);
    if (!b || !mine) throw new Error("You're not in that Bowl.");
    if (mine.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${mine.subscription_id}/cancel`, { body: { reason: "Left the Bowl" } }).catch(() => undefined);
    return d.tx(async (q) => {
      await q.query(`update bowl_members set status='left' where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
      const stay = await q.query<{ user_id: string }>(`select user_id from bowl_members where bowl_id=$1 and status <> 'left' order by user_id`, [bowlId]);
      if (!stay.length) {
        // The last friend left (edge case G4): only the account holder is left, so the Bowl closes.
        await q.query(`update bowls set status='closed' where id=$1`, [bowlId]);
        await logEvent(q, { userId: b.owner_id, squadId: b.squad_id, actor: "kitten", type: "bowl.closed", objectType: "bowl", objectId: bowlId, payload: { text: `Everyone left ${b.service}, so I closed it in the Bowl.` } });
        return { ok: true, newShares: {} as Record<string, number>, closed: true };
      }
      const seats = stay.length + 1; // + the account holder
      const shares = splitCents(b.total_cents, Array.from({ length: seats }, () => 1));
      await q.query(`update bowls set seats=$2 where id=$1`, [bowlId, seats]);
      for (const [i, m] of stay.entries()) {
        await q.query(`update bowl_members set share_cents=$3, status='pending' where bowl_id=$1 and user_id=$2`, [bowlId, m.user_id, shares[i + 1]]);
        await logEvent(q, { userId: m.user_id, squadId: b.squad_id, actor: "kitten", type: "bowl.reshare", objectType: "bowl", objectId: bowlId, payload: { bowlId, shareCents: shares[i + 1], text: `Someone left ${b.service}. Your new share is ${fmt(shares[i + 1])} a month. Confirm?` } });
      }
      return { ok: true, newShares: Object.fromEntries(stay.map((m, i) => [m.user_id, shares[i + 1]])) as Record<string, number>, closed: false };
    });
  });
}

/** The account holder closes the Bowl: no more months; members' subscriptions are cancelled and they're told. */
export async function closeBowl(ownerId: string, bowlId: string) {
  return withLock(`bowl:${bowlId}`, async () => {
    const d = await db();
    const [b] = await d.query<{ squad_id: string; owner_id: string; service: string; status: string }>(`select squad_id, owner_id, service, status from bowls where id=$1`, [bowlId]);
    if (!b || b.owner_id !== ownerId) throw new Error("Only the account holder can close this Bowl.");
    if (b.status !== "active") throw new Error("That Bowl is already closed.");
    const members = await d.query<{ user_id: string; subscription_id: string | null }>(`select user_id, subscription_id from bowl_members where bowl_id=$1 and status <> 'left'`, [bowlId]);
    for (const m of members) if (m.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${m.subscription_id}/cancel`, { body: { reason: "The Bowl was closed" } }).catch(() => undefined);
    await d.tx(async (q) => {
      await q.query(`update bowls set status='closed' where id=$1`, [bowlId]);
      await q.query(`update bowl_members set status='left' where bowl_id=$1 and status <> 'left'`, [bowlId]);
      for (const m of members) {
        await logEvent(q, { userId: m.user_id, squadId: b.squad_id, actor: "kitten", type: "bowl.closed", objectType: "bowl", objectId: bowlId, payload: { text: `${b.service} left the Bowl. No more monthly shares.` } });
      }
      await logEvent(q, { squadId: b.squad_id, actor: "user", actorId: ownerId, type: "bowl.closed", objectType: "bowl", objectId: bowlId, public: { text: `${b.service} is out of the Bowl.` } });
    });
    return { ok: true };
  });
}

export async function bowlView(userId: string, bowlId: string) {
  const d = await db();
  const [b] = await d.query<{ squad_id: string; owner_id: string; service: string; total_cents: number; seats: number; status: string }>(`select squad_id, owner_id, service, total_cents, seats, status from bowls where id=$1`, [bowlId]);
  if (!b || !(await isMember(d, b.squad_id, userId))) throw new Error("No such Bowl.");
  const members = await d.query<{ name: string; status: string }>(`select u.name, m.status from bowl_members m join users u on u.id=m.user_id where m.bowl_id=$1`, [bowlId]);
  const [mine] = await d.query<{ share_cents: number; status: string; approve_url: string | null }>(`select share_cents, status, approve_url from bowl_members where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
  const cycles = await d.query<{ collected_cents: number; missed: number; created_at: string }>(`select collected_cents, missed, created_at from bowl_cycles where bowl_id=$1 order by created_at desc limit 6`, [bowlId]);
  return { bowl: { id: bowlId, service: b.service, totalCents: b.total_cents, seats: b.seats, owner: b.owner_id === userId }, members, mine: mine ?? null, cycles: b.owner_id === userId ? cycles : undefined };
}

/** Job: run each active Bowl's monthly cycle when it's due. */
export async function bowlJobs(now = new Date()) {
  const d = await db();
  const due = await d.query<{ id: string }>(
    `select b.id from bowls b where b.status='active' and coalesce((select max(created_at) from bowl_cycles c where c.bowl_id=b.id), b.created_at - interval '31 days') < $1::timestamptz - interval '30 days'`,
    [now.toISOString()],
  );
  let ran = 0;
  for (const b of due) {
    try {
      const r = await bowlCycle(b.id, { dueAt: now });
      if ("skipped" in r) continue;
      ran++;
    } catch (e) {
      console.error(`[bowl] cycle failed: ${(e as Error).message}`);
    }
  }
  return { cycles: ran };
}

/** PayPal webhook PAYMENT.SALE.COMPLETED for a Bowl share subscription → record it for this cycle's payout. */
export async function creditBowlFromWebhook(subscriptionId: string, cents: number, saleId: string) {
  const d = await db();
  const [m] = await d.query<{ bowl_id: string; user_id: string }>(`select bowl_id, user_id from bowl_members where subscription_id=$1`, [subscriptionId]);
  if (!m) return false;
  const seen = await d.query(`select 1 from ledger where paypal_id=$1 and kind='bowl_share' limit 1`, [saleId]);
  if (seen.length) return true;
  await d.tx(async (q) => {
    await move(q, acct.world, acct.bowl(m.bowl_id), cents, { kind: "bowl_share", userId: m.user_id, paypalId: saleId, reason: "Bowl share (PayPal subscription)" });
    await q.query(`update bowl_members set status='active', last_paid_at=now() where bowl_id=$1 and user_id=$2`, [m.bowl_id, m.user_id]);
  });
  return true;
}
