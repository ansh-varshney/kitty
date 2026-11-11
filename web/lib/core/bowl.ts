import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { getUser, isMember } from "./users";
import { jarBalances } from "./month";
import { splitCents } from "../referee/shares";
import { testCardPayment } from "../paypal/holds";
import { paypalRequest } from "../paypal/rest";
import { withLock } from "./locks";
import { nextDayOfMonth, ordinal, validTz } from "../referee/time";

/**
 * The Bowl: shared subscriptions (PRD §B15, FR-BOWL-1..5). It works like Kitty Party: everyone in it, including whoever
 * holds the account, has a monthly amount and a day of the month they pick. On that day each person's share moves from
 * their Treat Jar into the account holder's. The holder's own share only gets counted, since they pay the provider
 * themselves. If a jar is short the share waits and the kitten asks for a top-up (FR-JAR-7).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

type BowlRow = { id: string; squad_id: string; owner_id: string; service: string; status: string };

async function activeBowl(q: Queryable, bowlId: string) {
  const [b] = await q.query<BowlRow>(`select id, squad_id, owner_id, service, status from bowls where id=$1 and status='active'`, [bowlId]);
  return b ?? null;
}

/** The standing instruction the kitten is following, listed with the squad's rules (same as a Kitty Party's R6). */
async function setRule(q: Queryable, b: BowlRow, userId: string, cents: number, day: number | null) {
  await q.query(`delete from rules where user_id=$1 and type='R8' and params->>'bowlId'=$2`, [userId, b.id]);
  const when = day ? `, on the ${ordinal(day)}` : "";
  const text = userId === b.owner_id ? `My ${b.service} share is ${fmt(cents)} a month${when}` : `Pay ${fmt(cents)} a month for ${b.service}, from my Treat Jar${when}`;
  await q.query(`insert into rules (user_id, squad_id, type, params, text) values ($1,$2,'R8',$3,$4)`, [userId, b.squad_id, JSON.stringify({ cents, bowlId: b.id, day }), text]);
}

export async function createBowl(ownerId: string, input: { squadId: string; service: string; totalCents: number; seats: number; memberIds: string[]; payDay?: number }) {
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
  await d.query(`insert into bowl_members (bowl_id, user_id, share_cents) values ($1,$2,$3)`, [b.id, ownerId, shares[0]]);
  for (const [i, m] of members.entries()) {
    const share = shares[i + 1];
    await d.query(`insert into bowl_members (bowl_id, user_id, share_cents) values ($1,$2,$3)`, [b.id, m, share]);
    await logEvent(d, { userId: m, squadId: input.squadId, actor: "kitten", type: "bowl.invite", objectType: "bowl", objectId: b.id, payload: { bowlId: b.id, shareCents: share, text: `${owner?.name} set up ${input.service} in the Bowl. Your share: ${fmt(share)} a month, from your Treat Jar. Join?` } });
  }
  await logEvent(d, { squadId: input.squadId, actor: "user", actorId: ownerId, type: "bowl.created", objectType: "bowl", objectId: b.id, public: { text: `${input.service} is in the Bowl now.` } });
  await joinBowl(ownerId, b.id, input.payDay);
  return { bowlId: b.id, shares: Object.fromEntries(members.map((m, i) => [m, shares[i + 1]])), ownerShareCents: shares[0] };
}

/** Join, and pick the day of the month my share moves (FR-BOWL-2). Tapping Join is the yes. */
export async function joinBowl(userId: string, bowlId: string, payDay?: number) {
  if (payDay !== undefined && (!Number.isInteger(payDay) || payDay < 1 || payDay > 28)) throw new Error("Pick a day from 1 to 28.");
  return withLock(`bowl:${bowlId}:${userId}`, () => joinBowlNow(userId, bowlId, payDay));
}

async function joinBowlNow(userId: string, bowlId: string, payDay?: number) {
  const d = await db();
  const [m] = await d.query<{ share_cents: number; status: string; subscription_id: string | null; pay_day: number | null; next_pay_at: string | null }>(
    `select share_cents, status, subscription_id, pay_day, next_pay_at from bowl_members where bowl_id=$1 and user_id=$2`,
    [bowlId, userId],
  );
  if (!m) throw new Error("You're not in that Bowl.");
  const b = await activeBowl(d, bowlId);
  if (!b) throw new Error("That Bowl is closed.");
  // Shares were recomputed when you left; coming back at the old share would overcharge the group (edge case G3).
  if (m.status === "left") throw new Error("You left this Bowl. Ask the account holder to add you again.");
  if (m.status === "active") return { ok: true, status: "active" };
  // Anyone who joined when a share was a PayPal subscription: end it, so they aren't charged twice.
  if (m.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${m.subscription_id}/cancel`, { body: { reason: "Now paying from the Treat Jar" } }).catch(() => undefined);
  const now = new Date();
  const tz = validTz((await getUser(d, userId))?.tz);
  const day = payDay ?? m.pay_day ?? null;
  // Confirming a new share isn't a new start: it keeps the date you already had.
  const keep = Boolean(m.next_pay_at) && m.pay_day === day;
  const nextAt = keep ? new Date(m.next_pay_at!) : day ? nextDayOfMonth(day, tz, now) : now;
  await d.tx(async (q) => {
    await q.query(`update bowl_members set status='active', subscription_id=null, approve_url=null, pay_day=$3, next_pay_at=$4 where bowl_id=$1 and user_id=$2`, [bowlId, userId, day, nextAt.toISOString()]);
    await setRule(q, b, userId, m.share_cents, day);
    await logEvent(q, { userId, squadId: b.squad_id, actor: "user", actorId: userId, type: "bowl.joined", objectType: "bowl", objectId: bowlId, payload: { cents: m.share_cents, day, text: userId === b.owner_id ? `Your ${b.service} share is ${fmt(m.share_cents)} a month${day ? `, on the ${ordinal(day)}` : ""}. Everyone else's comes to your Treat Jar.` : `You'll pay ${fmt(m.share_cents)} a month for ${b.service} from your Treat Jar${day ? `, on the ${ordinal(day)}` : ""}.` } });
  });
  const first = nextAt <= now ? await payShareNow(b, userId, now) : null;
  return { ok: true, status: "active", nextPayAt: nextAt.toISOString(), first };
}

/** Short on the day: the share waits, and the kitten asks for a top-up, at most once in 3 days (same as Kitty Party, FR-PARTY-8). */
async function askForTopUp(b: BowlRow, userId: string, cents: number, availableCents: number) {
  const d = await db();
  const asked = await d.query(`update bowl_members set payment_failed_at=now() where bowl_id=$1 and user_id=$2 and (payment_failed_at is null or payment_failed_at < now() - interval '3 days') returning user_id`, [b.id, userId]);
  if (!asked.length) return;
  const shortCents = cents - availableCents;
  await logEvent(d, { userId, squadId: b.squad_id, actor: "kitten", type: "bowl.payment_failed", objectType: "bowl", objectId: b.id, payload: { cents, shortCents, text: `Your Treat Jar was ${fmt(shortCents)} short for your ${fmt(cents)} ${b.service} share. No penalty.` }, reason: "there wasn't enough in your Treat Jar on your day" });
}

/** The squad sees how many shares are in, never whose (like a Kitty Party's jar line). Run after the share is marked paid. */
async function noteShares(q: Queryable, b: BowlRow) {
  const [c] = await q.query<{ paid: number; total: number }>(`select count(*) filter (where status='active' and last_paid_at >= date_trunc('month', now()))::int as paid, count(*) filter (where status <> 'left')::int as total from bowl_members where bowl_id=$1`, [b.id]);
  await logEvent(q, { squadId: b.squad_id, actor: "system", type: "bowl.share_in", objectType: "bowl", objectId: b.id, public: { text: `${b.service}: ${c.paid} of ${c.total} shares are in this month.` } });
}

/** One month's share: from the member's Treat Jar to the account holder's. Callers hold the member's lock. */
async function payShareNow(b: BowlRow, userId: string, now = new Date()) {
  const d = await db();
  const [m] = await d.query<{ share_cents: number; status: string; pay_day: number | null }>(`select share_cents, status, pay_day from bowl_members where bowl_id=$1 and user_id=$2`, [b.id, userId]);
  if (!m || m.status !== "active") throw new Error("Not an active member.");
  const user = await getUser(d, userId);
  if (userId === b.owner_id) {
    // The holder pays the provider themselves, so no money moves. It's recorded so their month shows it like everyone else's.
    const nextDate = nextDayOfMonth(m.pay_day ?? 1, validTz(user?.tz), now, { afterToday: true });
    await d.tx(async (q) => {
      await move(q, acct.world, acct.bowl(b.id), m.share_cents, { kind: "bowl_share", userId, reason: `your ${b.service} share` });
      await move(q, acct.bowl(b.id), acct.world, m.share_cents, { kind: "bowl_to_holder", userId, reason: `you pay ${b.service} yourself` });
      await q.query(`update bowl_members set last_paid_at=now(), next_pay_at=$3, payment_failed_at=null, collected_count=collected_count+1 where bowl_id=$1 and user_id=$2`, [b.id, userId, nextDate.toISOString()]);
      await logEvent(q, { userId, squadId: b.squad_id, actor: "kitten", type: "bowl.paid", objectType: "bowl", objectId: b.id, payload: { cents: m.share_cents, text: `Your ${b.service} share, ${fmt(m.share_cents)}, is counted for this month. You pay ${b.service} yourself, so nothing left your Treat Jar.` } });
      await noteShares(q, b);
    });
    return { paid: true as const, cents: m.share_cents };
  }
  let { availableCents } = await jarBalances(d, userId);
  if (availableCents < m.share_cents && user?.is_demo) {
    // Demo friends can't approve a refill, so the sandbox test card fills the jar for them.
    const short = m.share_cents - availableCents;
    const pay = await testCardPayment({ cents: short, customId: `jar:${userId}` });
    await d.tx((q) => move(q, acct.world, acct.jar(userId), short, { kind: "jar_topup", userId, paypalId: pay.captureId, reason: "Treat Jar top-up" }));
    availableCents += short;
  }
  if (availableCents < m.share_cents) {
    await askForTopUp(b, userId, m.share_cents, availableCents);
    return { paid: false as const, shortCents: m.share_cents - availableCents };
  }
  const next = nextDayOfMonth(m.pay_day ?? 1, validTz(user?.tz), now, { afterToday: true });
  const [payer, holder] = [user?.name ?? "Someone", (await getUser(d, b.owner_id))?.name ?? "the account holder"];
  await d.tx(async (q) => {
    await move(q, acct.jar(userId), acct.bowl(b.id), m.share_cents, { kind: "bowl_share", userId, reason: `${b.service} share, from your Treat Jar` });
    await move(q, acct.bowl(b.id), acct.jar(b.owner_id), m.share_cents, { kind: "bowl_to_holder", userId: b.owner_id, reason: `${payer}'s ${b.service} share` });
    await q.query(`update bowl_members set last_paid_at=now(), next_pay_at=$3, payment_failed_at=null, collected_count=collected_count+1 where bowl_id=$1 and user_id=$2`, [b.id, userId, next.toISOString()]);
    await logEvent(q, { userId, squadId: b.squad_id, actor: "kitten", type: "bowl.paid", objectType: "bowl", objectId: b.id, payload: { cents: m.share_cents, text: `Paid your ${b.service} share, ${fmt(m.share_cents)}, from your Treat Jar to ${holder}.` } });
    await logEvent(q, { userId: b.owner_id, squadId: b.squad_id, actor: "kitten", type: "bowl.received", objectType: "bowl", objectId: b.id, payload: { cents: m.share_cents, text: `${payer}'s ${b.service} share, ${fmt(m.share_cents)}, is in your Treat Jar.` } });
    await noteShares(q, b);
  });
  return { paid: true as const, cents: m.share_cents };
}

/** Take every active share now, whatever the date (dev tools and tests). */
export async function bowlCycle(bowlId: string) {
  const d = await db();
  const b = await activeBowl(d, bowlId);
  if (!b) throw new Error("That Bowl is closed.");
  const members = await d.query<{ user_id: string }>(`select user_id from bowl_members where bowl_id=$1 and status='active'`, [bowlId]);
  let collectedCents = 0;
  let waiting = 0;
  for (const m of members) {
    const r = await withLock(`bowl:${bowlId}:${m.user_id}`, () => payShareNow(b, m.user_id));
    if (!r.paid) waiting++;
    else if (m.user_id !== b.owner_id) collectedCents += r.cents;
  }
  return { collectedCents, waiting };
}

/** A seat leaves: shares are recomputed and the others confirm (FR-BOWL-3). */
export async function leaveBowl(userId: string, bowlId: string) {
  return withLock(`bowl:${bowlId}`, async () => {
    const d = await db();
    const [b] = await d.query<BowlRow & { total_cents: number; seats: number }>(`select id, squad_id, owner_id, total_cents, seats, service, status from bowls where id=$1`, [bowlId]);
    if (b?.owner_id === userId) throw new Error("You hold this Bowl's account. Close the Bowl instead.");
    const [mine] = await d.query<{ subscription_id: string | null }>(`select subscription_id from bowl_members where bowl_id=$1 and user_id=$2 and status <> 'left'`, [bowlId, userId]);
    if (!b || !mine) throw new Error("You're not in that Bowl.");
    if (mine.subscription_id) await paypalRequest("POST", `/v1/billing/subscriptions/${mine.subscription_id}/cancel`, { body: { reason: "Left the Bowl" } }).catch(() => undefined);
    return d.tx(async (q) => {
      await q.query(`update bowl_members set status='left' where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
      await q.query(`update rules set active=false where user_id=$1 and type='R8' and params->>'bowlId'=$2`, [userId, bowlId]);
      const stay = await q.query<{ user_id: string }>(`select user_id from bowl_members where bowl_id=$1 and status <> 'left' and user_id <> $2 order by user_id`, [bowlId, b.owner_id]);
      if (!stay.length) {
        // The last friend left (edge case G4): only the account holder is left, so the Bowl closes.
        await q.query(`update bowls set status='closed' where id=$1`, [bowlId]);
        await q.query(`update bowl_members set status='left' where bowl_id=$1`, [bowlId]);
        await q.query(`update rules set active=false where type='R8' and params->>'bowlId'=$1`, [bowlId]);
        await logEvent(q, { userId: b.owner_id, squadId: b.squad_id, actor: "kitten", type: "bowl.closed", objectType: "bowl", objectId: bowlId, payload: { text: `Everyone left ${b.service}, so I closed it in the Bowl.` } });
        return { ok: true, newShares: {} as Record<string, number>, closed: true };
      }
      const seats = stay.length + 1; // + the account holder
      const shares = splitCents(b.total_cents, Array.from({ length: seats }, () => 1));
      await q.query(`update bowls set seats=$2 where id=$1`, [bowlId, seats]);
      const [holder] = await q.query<{ pay_day: number | null }>(`update bowl_members set share_cents=$3 where bowl_id=$1 and user_id=$2 returning pay_day`, [bowlId, b.owner_id, shares[0]]);
      if (holder) await setRule(q, b, b.owner_id, shares[0], holder.pay_day);
      await logEvent(q, { userId: b.owner_id, squadId: b.squad_id, actor: "kitten", type: "bowl.reshare", objectType: "bowl", objectId: bowlId, payload: { bowlId, shareCents: shares[0], text: `Someone left ${b.service}. Your share is now ${fmt(shares[0])} a month.` } });
      for (const [i, m] of stay.entries()) {
        await q.query(`update bowl_members set share_cents=$3, status='pending' where bowl_id=$1 and user_id=$2`, [bowlId, m.user_id, shares[i + 1]]);
        await logEvent(q, { userId: m.user_id, squadId: b.squad_id, actor: "kitten", type: "bowl.reshare", objectType: "bowl", objectId: bowlId, payload: { bowlId, shareCents: shares[i + 1], text: `Someone left ${b.service}. Your new share is ${fmt(shares[i + 1])} a month. Confirm?` } });
      }
      return { ok: true, newShares: Object.fromEntries(stay.map((m, i) => [m.user_id, shares[i + 1]])) as Record<string, number>, closed: false };
    });
  });
}

/** The account holder closes the Bowl: no more months; members are told. */
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
      await q.query(`update rules set active=false where type='R8' and params->>'bowlId'=$1`, [bowlId]);
      for (const m of members.filter((x) => x.user_id !== ownerId)) {
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
  const members = await d.query<{ user_id: string; name: string; status: string; share_cents: number; pay_day: number | null }>(`select m.user_id, u.name, m.status, m.share_cents, m.pay_day from bowl_members m join users u on u.id=m.user_id where m.bowl_id=$1 order by (m.user_id = $2) desc, u.name`, [bowlId, b.owner_id]);
  const [mine] = await d.query<{ share_cents: number; status: string; pay_day: number | null; next_pay_at: string | null }>(`select share_cents, status, pay_day, next_pay_at from bowl_members where bowl_id=$1 and user_id=$2`, [bowlId, userId]);
  const holder = await getUser(d, b.owner_id);
  return {
    bowl: { id: bowlId, service: b.service, totalCents: b.total_cents, seats: b.seats, owner: b.owner_id === userId, ownerName: holder?.name ?? null, usualDay: members.find((m) => m.user_id === b.owner_id)?.pay_day ?? null },
    members: members.map((m) => ({ name: m.name, status: m.status, monthlyCents: m.share_cents, holder: m.user_id === b.owner_id })),
    mine: mine ?? null,
    myJarCents: (await jarBalances(d, userId)).availableCents,
  };
}

async function payEach(rows: { bowl_id: string; user_id: string }[], now: Date) {
  const d = await db();
  let paid = 0;
  for (const r of rows) {
    try {
      const b = await activeBowl(d, r.bowl_id);
      if (!b) continue;
      await withLock(`bowl:${r.bowl_id}:${r.user_id}`, async () => {
        // Another run may have got here first: look again now that this one holds the lock.
        const [still] = await d.query(`select 1 as x from bowl_members where bowl_id=$1 and user_id=$2 and status='active' and next_pay_at <= $3`, [r.bowl_id, r.user_id, now.toISOString()]);
        if (still && (await payShareNow(b, r.user_id, now)).paid) paid++;
      });
    } catch (e) {
      console.error(`[bowl] share failed: ${(e as Error).message}`);
    }
  }
  return paid;
}

/** Job: every share whose day has come. Short ones stay due, so a later run picks them up. */
export async function bowlJobs(now = new Date()) {
  const d = await db();
  const due = await d.query<{ bowl_id: string; user_id: string }>(`select m.bowl_id, m.user_id from bowl_members m join bowls b on b.id=m.bowl_id where m.status='active' and b.status='active' and m.next_pay_at <= $1`, [now.toISOString()]);
  return { paid: await payEach(due, now) };
}

/** After a Treat Jar top-up: whatever was waiting on it goes in straight away. */
export async function payDueFor(userId: string, now = new Date()) {
  const d = await db();
  const due = await d.query<{ bowl_id: string; user_id: string }>(`select m.bowl_id, m.user_id from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='active' and b.status='active' and m.next_pay_at <= $2`, [userId, now.toISOString()]);
  return payEach(due, now);
}

/** Only for anyone who joined when a share was a PayPal subscription: money PayPal did take still reaches the account holder. */
export async function creditBowlFromWebhook(subscriptionId: string, cents: number, saleId: string) {
  const d = await db();
  const [m] = await d.query<{ bowl_id: string; user_id: string; owner_id: string }>(`select x.bowl_id, x.user_id, b.owner_id from bowl_members x join bowls b on b.id=x.bowl_id where x.subscription_id=$1`, [subscriptionId]);
  if (!m) return false;
  const seen = await d.query(`select 1 from ledger where paypal_id=$1 and kind='bowl_share' limit 1`, [saleId]);
  if (seen.length) return true;
  await d.tx(async (q) => {
    await move(q, acct.world, acct.bowl(m.bowl_id), cents, { kind: "bowl_share", userId: m.user_id, paypalId: saleId, reason: "Bowl share (PayPal subscription)" });
    await move(q, acct.bowl(m.bowl_id), acct.jar(m.owner_id), cents, { kind: "bowl_to_holder", userId: m.owner_id, reason: "Bowl share (PayPal subscription)" });
    await q.query(`update bowl_members set status='active', last_paid_at=now() where bowl_id=$1 and user_id=$2`, [m.bowl_id, m.user_id]);
  });
  return true;
}
