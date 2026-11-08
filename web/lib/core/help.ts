import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct, move } from "./ledger";
import { getUser, listRules } from "./users";
import { jarBalances } from "./month";
import { payOut } from "./money-flow";
import { decide } from "../referee/rules";
import { baseUrl } from "../env";
import { authorizeHold, captureHold, createTestCardHold, createWalletHold, voidHold } from "../paypal/holds";
import { withLock } from "./locks";

/**
 * Nine Lives: help a friend (PRD §B12, FR-LIVES-1..6, AT-17). Requests are private to the chosen friends; each
 * friend's kitten suggests an amount from their help rule; pledges are Treat Jar reservations or PayPal holds;
 * the requester can accept any time (partial is fine) and gets ONE Payout. Declines are invisible.
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

function helpRuleCents(rules: { type: string; params: Record<string, unknown>; active?: boolean; squadId?: string | null }[]) {
  const r = rules.find((x) => x.active !== false && x.type === "R3" && !x.squadId);
  return Number(r?.params.cents ?? 0) || 0;
}

export async function askForHelp(
  requesterId: string,
  input: { cents: number; note: string; kind?: "gift" | "loan" | "either"; neededBy?: string | null; friendIds: string[] },
) {
  const d = await db();
  if (!Number.isInteger(input.cents) || input.cents <= 0) throw new Error("Pick an amount.");
  const friends = [...new Set(input.friendIds)].filter((f) => f !== requesterId);
  if (!friends.length) throw new Error("Choose who to ask.");
  // A real squad, not just a secret gift group: a loan has to land in a squad's Yarn (edge case E5).
  for (const f of friends) if (!(await shareRealSquad(d, requesterId, f))) throw new Error("You can only ask friends you share a squad with.");
  if (input.neededBy && input.neededBy < new Date().toISOString().slice(0, 10)) throw new Error("The \"needed by\" date is in the past.");
  const [open] = await d.query<{ n: number }>(`select count(*)::int as n from help_requests where requester_id=$1 and status='open'`, [requesterId]);
  if (open.n > 0) throw new Error("You already have an open request. Close it first.");
  const [recent] = await d.query<{ n: number }>(`select count(*)::int as n from help_requests where requester_id=$1 and created_at > now() - interval '90 days'`, [requesterId]);
  if (recent.n >= 3) throw new Error("That's 3 requests in 90 days, the most Nine Lives allows.");
  const me = await getUser(d, requesterId);

  return d.tx(async (q) => {
    const [r] = await q.query<{ id: string }>(
      `insert into help_requests (requester_id, cents, note, kind, needed_by) values ($1,$2,$3,$4,$5) returning id`,
      [requesterId, input.cents, input.note.slice(0, 140), input.kind ?? "either", input.neededBy ?? null],
    );
    for (const f of friends) {
      const suggested = Math.min(helpRuleCents(await listRules(q, f)), input.cents);
      await q.query(`insert into help_asks (request_id, user_id, suggested_cents) values ($1,$2,$3)`, [r.id, f, suggested]);
      // Written plainly and kindly; never in a squad chat (FR-LIVES-2).
      await logEvent(q, {
        userId: f,
        actor: "kitten",
        type: "help.asked",
        objectType: "help",
        objectId: r.id,
        payload: {
          requestId: r.id,
          suggestedCents: suggested,
          text: `${me?.name} could use a hand: ${input.note} (${fmt(input.cents)}${input.neededBy ? ` by ${input.neededBy}` : ""}). ${suggested ? `From your help rule I'd suggest ${fmt(suggested)}.` : "Your help rule is $0, so it's entirely up to you."}`,
        },
        reason: "a friend asked you privately",
      });
    }
    await logEvent(q, { userId: requesterId, actor: "kitten", type: "help.sent", objectType: "help", objectId: r.id, payload: { cents: input.cents, asked: friends.length, text: `I asked ${friends.length} friend${friends.length > 1 ? "s" : ""} privately for ${fmt(input.cents)}.` } });
    return { requestId: r.id, asked: friends.length };
  });
}

async function shareRealSquad(q: Queryable, a: string, b: string) {
  const r = await q.query(
    `select 1 from memberships x join memberships y on x.squad_id=y.squad_id join squads s on s.id=x.squad_id
     where x.user_id=$1 and y.user_id=$2 and x.left_at is null and y.left_at is null and s.kind <> 'gift' limit 1`,
    [a, b],
  );
  return r.length > 0;
}

/** A friend pledges: Treat Jar (within free hand) or a PayPal hold (FR-LIVES-4). One at a time per request. */
export async function pledgeHelp(userId: string, requestId: string, input: { cents: number; asLoan?: boolean }) {
  return withLock(`help:${requestId}`, () => pledgeHelpNow(userId, requestId, input));
}

async function pledgeHelpNow(userId: string, requestId: string, input: { cents: number; asLoan?: boolean }) {
  const d = await db();
  const [req] = await d.query<{ requester_id: string; cents: number; kind: string; status: string }>(`select requester_id, cents, kind, status from help_requests where id=$1`, [requestId]);
  const [ask] = await d.query<{ status: string }>(`select status from help_asks where request_id=$1 and user_id=$2`, [requestId, userId]);
  if (!req || !ask) throw new Error("That request isn't for you.");
  if (req.status !== "open") throw new Error("That request is closed.");
  const mine = await d.query(`select 1 from help_pledges where request_id=$1 and user_id=$2 and status in ('held','pending') limit 1`, [requestId, userId]);
  if (mine.length) throw new Error("You've already pledged. Take it back first if you want to change it.");
  if (!Number.isInteger(input.cents) || input.cents <= 0) throw new Error("Pick an amount.");
  const stillNeeded = req.cents - (await requestTotals(d, requestId)).pledgedCents;
  if (stillNeeded <= 0) throw new Error("Your friend's request is already covered.");
  input = { ...input, cents: Math.min(input.cents, stillNeeded) }; // never more than they asked for
  const asLoan = req.kind === "loan" ? true : req.kind === "gift" ? false : Boolean(input.asLoan);
  const user = await getUser(d, userId);
  const rules = (await listRules(d, userId)).filter((r) => r.type !== "R1");
  const jar = await jarBalances(d, userId);
  const dec = decide({ kind: "help", cents: input.cents, source: "jar" }, { rules, jarAvailableCents: jar.availableCents, monthSpentCents: 0, monthCommittedCents: 0 });

  let pledge: { id: string; source: string; approveUrl?: string };
  if (dec.mode === "auto") {
    pledge = await d.tx(async (q) => {
      await move(q, acct.jar(userId), acct.jarHeld(userId), input.cents, { kind: "jar_reserve", userId, reason: "Nine Lives pledge" });
      const [p] = await q.query<{ id: string }>(`insert into help_pledges (request_id, user_id, cents, as_loan, source, status) values ($1,$2,$3,$4,'jar','held') returning id`, [requestId, userId, input.cents, asLoan]);
      return { id: p.id, source: "jar" };
    });
  } else if (user?.is_demo) {
    const hold = await createTestCardHold({ cents: input.cents, referenceId: requestId, customId: `help:${userId.slice(0, 8)}` });
    const [p] = await d.query<{ id: string }>(
      `insert into help_pledges (request_id, user_id, cents, as_loan, source, order_id, authorization_id, status) values ($1,$2,$3,$4,'paypal',$5,$6,'held') returning id`,
      [requestId, userId, input.cents, asLoan, hold.orderId, hold.authorizationId],
    );
    pledge = { id: p.id, source: "paypal" };
  } else {
    const base = baseUrl();
    const { orderId, approveUrl } = await createWalletHold({ cents: input.cents, referenceId: requestId, customId: `help:${userId.slice(0, 8)}`, description: "Kitty: Nine Lives pledge", returnUrl: `${base}/api/v1/return/help`, cancelUrl: `${base}/?cancelled=help` });
    const [p] = await d.query<{ id: string }>(
      `insert into help_pledges (request_id, user_id, cents, as_loan, source, order_id, approve_url, status) values ($1,$2,$3,$4,'paypal',$5,$6,'pending') returning id`,
      [requestId, userId, input.cents, asLoan, orderId, approveUrl],
    );
    pledge = { id: p.id, source: "paypal", approveUrl };
  }
  await d.query(`update help_asks set status='pledged' where request_id=$1 and user_id=$2`, [requestId, userId]);
  await logEvent(d, { userId, actor: "user", actorId: userId, type: "help.pledged", objectType: "help", objectId: requestId, payload: { cents: input.cents, asLoan, source: pledge.source, text: `You pledged ${fmt(input.cents)}${asLoan ? " as a no-interest loan" : ""}. It's only taken if they accept.` } });
  // The requester sees the total, not who (helpers are anonymous by default).
  await logEvent(d, { userId: req.requester_id, actor: "kitten", type: "help.progress", objectType: "help", objectId: requestId, payload: { ...(await requestTotals(d, requestId)), text: `A friend pledged ${fmt(input.cents)}.` } });
  const t = await requestTotals(d, requestId);
  if (t.pledgedCents >= req.cents) await acceptHelpNow(req.requester_id, requestId); // full: fill straight away
  return { ok: true, pledgeId: pledge.id, source: pledge.source, approveUrl: pledge.approveUrl };
}

/**
 * Take a pledge back before it's accepted (FR-LOG-3: releasing a hold or a Treat Jar reservation is undoable).
 * The requester only sees the total change, never who (helpers are anonymous).
 */
export async function unpledgeHelp(userId: string, requestId: string) {
  return withLock(`help:${requestId}`, async () => {
    const d = await db();
    const [req] = await d.query<{ requester_id: string; status: string }>(`select requester_id, status from help_requests where id=$1`, [requestId]);
    if (!req) throw new Error("That request isn't for you.");
    if (req.status !== "open") throw new Error("That request is already closed, so the pledge can't be taken back.");
    const pledges = await d.query<{ id: string; cents: number; source: string; status: string; authorization_id: string | null }>(
      `select id, cents, source, status, authorization_id from help_pledges where request_id=$1 and user_id=$2 and status in ('held','pending')`,
      [requestId, userId],
    );
    if (!pledges.length) throw new Error("You haven't pledged to this request.");
    for (const p of pledges) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
    await d.tx(async (q) => {
      for (const p of pledges) {
        if (p.source === "jar" && p.status === "held") await move(q, acct.jarHeld(userId), acct.jar(userId), p.cents, { kind: "jar_release", userId, reason: "Nine Lives pledge taken back" });
        await q.query(`update help_pledges set status='voided' where id=$1`, [p.id]);
      }
      await q.query(`update help_asks set status='asked' where request_id=$1 and user_id=$2`, [requestId, userId]);
      await logEvent(q, { userId, actor: "user", actorId: userId, type: "help.unpledged", objectType: "help", objectId: requestId, payload: { text: "You took your pledge back. Nothing was taken." } });
      await logEvent(q, { userId: req.requester_id, actor: "kitten", type: "help.progress", objectType: "help", objectId: requestId, payload: { ...(await requestTotals(q, requestId)), text: "A pledge was taken back." } });
    });
    return { ok: true, released: pledges.length };
  });
}

/** "Not this time": invisible to everyone else (FR-LIVES-6). */
export async function declineHelp(userId: string, requestId: string) {
  const d = await db();
  const r = await d.query(`update help_asks set status='declined' where request_id=$1 and user_id=$2 and status='asked' returning 1`, [requestId, userId]);
  if (!r.length) throw new Error("Nothing to decline.");
  return { ok: true };
}

async function requestTotals(q: Queryable, requestId: string) {
  const [t] = await q.query<{ pledged: string | null; helpers: number }>(
    `select coalesce(sum(cents),0) as pledged, count(distinct user_id)::int as helpers from help_pledges where request_id=$1 and status='held'`,
    [requestId],
  );
  return { pledgedCents: Number(t.pledged ?? 0), helpers: t.helpers };
}

/** Open requests that asked me, with my own pledge (if any), so I can pledge, decline or take it back. */
export async function myHelpAsks(userId: string) {
  const d = await db();
  return d.query<{ request_id: string; from_name: string; cents: number; note: string; my_status: string; my_pledge_cents: number | null }>(
    `select r.id as request_id, u.name as from_name, r.cents, r.note, a.status as my_status,
            (select sum(p.cents)::int from help_pledges p where p.request_id=r.id and p.user_id=$1 and p.status in ('held','pending')) as my_pledge_cents
     from help_asks a join help_requests r on r.id=a.request_id join users u on u.id=r.requester_id
     where a.user_id=$1 and r.status='open' order by r.created_at desc`,
    [userId],
  );
}

/** What the requester sees: totals only, never who declined (FR-LIVES-6). */
export async function helpView(userId: string, requestId: string) {
  const d = await db();
  const [r] = await d.query<{ requester_id: string; cents: number; note: string; kind: string; status: string; received_cents: number | null; needed_by: string | null }>(
    `select requester_id, cents, note, kind, status, received_cents, needed_by from help_requests where id=$1`,
    [requestId],
  );
  if (!r) throw new Error("No such request.");
  if (r.requester_id === userId) return { request: r, ...(await requestTotals(d, requestId)) };
  const [ask] = await d.query<{ status: string; suggested_cents: number }>(`select status, suggested_cents from help_asks where request_id=$1 and user_id=$2`, [requestId, userId]);
  if (!ask) throw new Error("That request isn't for you.");
  return { request: { cents: r.cents, note: r.note, kind: r.kind, status: r.status, needed_by: r.needed_by }, mine: ask };
}

/** Accept what's pledged (any time, partial is fine): capture every pledge, ONE Payout to the requester. */
export async function acceptHelp(requesterId: string, requestId: string) {
  return withLock(`help:${requestId}`, () => acceptHelpNow(requesterId, requestId));
}

async function acceptHelpNow(requesterId: string, requestId: string) {
  const d = await db();
  const [req] = await d.query<{ requester_id: string; status: string }>(`select requester_id, status from help_requests where id=$1`, [requestId]);
  if (!req || req.requester_id !== requesterId) throw new Error("Not your request.");
  if (req.status !== "open") throw new Error("Already closed.");
  const held = await d.query<{ id: string; user_id: string; cents: number; source: string; authorization_id: string | null; as_loan: boolean }>(
    `select id, user_id, cents, source, authorization_id, as_loan from help_pledges where request_id=$1 and status='held'`,
    [requestId],
  );
  if (!held.length) throw new Error("No pledges yet.");
  // Capture each PayPal hold. One that fails (expired, declined) is dropped and its giver told; the rest still go
  // through, and nothing captured is ever left unrecorded (edge-case pass).
  const captured: { id: string; captureId?: string }[] = [];
  const failed: typeof held = [];
  for (const p of held.filter((x) => x.source === "paypal")) {
    try {
      captured.push({ id: p.id, captureId: (await captureHold(p.authorization_id!, p.cents, true)).captureId });
    } catch (e) {
      console.error(`[help] capture failed for pledge ${p.id}: ${(e as Error).message}`);
      failed.push(p);
    }
  }
  for (const f of failed) {
    await d.query(`update help_pledges set status='voided' where id=$1`, [f.id]);
    await logEvent(d, { userId: f.user_id, actor: "kitten", type: "help.pledge_failed", objectType: "help", objectId: requestId, payload: { cents: f.cents, text: `Your ${fmt(f.cents)} pledge couldn't be taken (the PayPal hold didn't go through). Nothing was charged.` } });
  }
  const pledges = held.filter((p) => !failed.includes(p));
  if (!pledges.length) throw new Error("None of the pledges could be taken just now. Nothing was charged.");
  const total = pledges.reduce((a, p) => a + p.cents, 0);
  const batch = await d.tx(async (q) => {
    for (const p of pledges) {
      if (p.source === "jar") await move(q, acct.jarHeld(p.user_id), acct.help(requestId), p.cents, { kind: "help_give", userId: p.user_id, reason: "Nine Lives" });
      else {
        const cap = captured.find((c) => c.id === p.id)!;
        await move(q, acct.world, acct.help(requestId), p.cents, { kind: "help_give", userId: p.user_id, paypalId: cap.captureId, reason: "Nine Lives" });
        await q.query(`update help_pledges set capture_id=$2 where id=$1`, [p.id, cap.captureId]);
      }
      await q.query(`update help_pledges set status='captured' where id=$1`, [p.id]);
      await logEvent(q, { userId: p.user_id, actor: "system", type: "help.given", objectType: "help", objectId: requestId, payload: { cents: p.cents, asLoan: p.as_loan, text: `Your ${fmt(p.cents)} reached your friend${p.as_loan ? " (as a no-interest loan in Yarn)" : ""}. Thank you.` } });
    }
    const b = await payOut(q, requesterId, total, acct.help(requestId), { note: "Nine Lives: help from your friends", itemId: `help-${requestId.slice(0, 8)}`, kind: "help_payout" });
    await q.query(`update help_requests set status='filled', received_cents=$2, payout_batch_id=$3, closed_at=now() where id=$1`, [requestId, total, b]);
    await q.query(`update help_asks set status='declined' where request_id=$1 and status='asked'`, [requestId]); // silently closed
    await logEvent(q, { userId: requesterId, actor: "kitten", type: "help.received", objectType: "help", objectId: requestId, payload: { cents: total, helpers: pledges.length, text: `${fmt(total)} from ${pledges.length} friend${pledges.length > 1 ? "s" : ""} is on its way to your PayPal. I'll send them a thank-you.` }, paypalId: b });
    // Loans become Yarn with no interest (FR-LIVES-5): one confirmed card per lender, in a squad they share.
    for (const p of pledges.filter((x) => x.as_loan)) {
      // Prefer a squad they're both still in; if one has left since, any real squad they shared keeps the record.
      const [s] = await q.query<{ squad_id: string }>(
        `select x.squad_id from memberships x join memberships y on x.squad_id=y.squad_id join squads s on s.id=x.squad_id
         where x.user_id=$1 and y.user_id=$2 and s.kind <> 'gift' order by (x.left_at is null and y.left_at is null) desc limit 1`,
        [p.user_id, requesterId],
      );
      if (!s) {
        await logEvent(q, { userId: p.user_id, actor: "kitten", type: "help.loan_note", objectType: "help", objectId: requestId, payload: { cents: p.cents, text: `Your ${fmt(p.cents)} loan is recorded here in your Diary (you no longer share a squad, so it isn't in Yarn).` } });
        continue;
      }
      const [c] = await q.query<{ id: string }>(
        `insert into yarn_cards (squad_id, payer_id, created_by, cents, note, kind, status, source_ref) values ($1,$2,$3,$4,'Nine Lives loan (no interest)','loan','confirmed',$5) returning id`,
        [s.squad_id, p.user_id, requesterId, p.cents, requestId],
      );
      await q.query(`insert into yarn_parts (card_id, user_id, cents, status) values ($1,$2,$3,'confirmed')`, [c.id, requesterId, p.cents]);
    }
    return b;
  });
  return { ok: true, receivedCents: total, helpers: pledges.length, payoutBatchId: batch };
}

/** The lender turns a loan into a gift (FR-LIVES-5). */
export async function loanToGift(lenderId: string, cardId: string) {
  const d = await db();
  const r = await d.query<{ squad_id: string }>(`update yarn_cards set status='void' where id=$1 and payer_id=$2 and kind='loan' returning squad_id`, [cardId, lenderId]);
  if (!r.length) throw new Error("That isn't your loan.");
  const [p] = await d.query<{ user_id: string }>(`select user_id from yarn_parts where card_id=$1`, [cardId]);
  await logEvent(d, { userId: p.user_id, actor: "kitten", type: "help.gift", objectType: "yarn", objectId: cardId, payload: { text: "A friend turned their loan into a gift. Nothing to pay back." } });
  return { ok: true };
}

/** Back from PayPal after approving a pledge hold (real users). */
export async function finishHelpHold(orderId: string) {
  const d = await db();
  const [p] = await d.query<{ id: string; request_id: string; status: string }>(`select id, request_id, status from help_pledges where order_id=$1`, [orderId]);
  if (!p) throw new Error("Unknown pledge");
  if (p.status !== "pending") return { requestId: p.request_id };
  const [r] = await d.query<{ status: string }>(`select status from help_requests where id=$1`, [p.request_id]);
  if (r?.status !== "open") {
    // Closed or filled while they were on PayPal: don't place the hold at all.
    await d.query(`update help_pledges set status='voided' where id=$1`, [p.id]);
    return { requestId: p.request_id, closed: true };
  }
  const h = await authorizeHold(orderId);
  await d.query(`update help_pledges set status='held', authorization_id=$2 where id=$1`, [p.id, h.authorizationId]);
  return { requestId: p.request_id };
}

/** Job: at the needed-by date, accept what's pledged; nothing pledged → close quietly (holds are voided). */
export async function helpJobs(now = new Date()) {
  const d = await db();
  const due = await d.query<{ id: string; requester_id: string }>(`select id, requester_id from help_requests where status='open' and needed_by is not null and needed_by < $1::date`, [now.toISOString().slice(0, 10)]);
  let filled = 0;
  for (const r of due) {
    const t = await requestTotals(d, r.id);
    if (t.pledgedCents > 0) {
      await acceptHelp(r.requester_id, r.id);
      filled++;
    } else await closeHelp(r.requester_id, r.id); // nothing held, but voids any approval still pending
  }
  // Help that was accepted but whose payout didn't go out (PayPal hiccup, or no PayPal email yet): try again.
  const unpaid = await d.query<{ id: string; requester_id: string; received_cents: number }>(
    `select id, requester_id, received_cents from help_requests where status='filled' and payout_batch_id is null and received_cents > 0`,
  );
  let payoutsRetried = 0;
  for (const r of unpaid) {
    const b = await d.tx((q) => payOut(q, r.requester_id, r.received_cents, acct.help(r.id), { note: "Nine Lives: help from your friends", itemId: `help-${r.id.slice(0, 8)}-r`, kind: "help_payout" }));
    if (b) {
      await d.query(`update help_requests set payout_batch_id=$2 where id=$1`, [r.id, b]);
      await logEvent(d, { userId: r.requester_id, actor: "kitten", type: "help.paid", objectType: "help", objectId: r.id, payload: { cents: r.received_cents, text: `${fmt(r.received_cents)} from your friends is on its way to your PayPal.` }, paypalId: b });
      payoutsRetried++;
    }
  }
  return { filled, payoutsRetried };
}

/** The requester closes a request: release every pledge (held or still waiting for PayPal approval). */
export async function closeHelp(requesterId: string, requestId: string) {
  return withLock(`help:${requestId}`, async () => {
    const d = await db();
    const [req] = await d.query<{ requester_id: string; status: string }>(`select requester_id, status from help_requests where id=$1`, [requestId]);
    if (!req || req.requester_id !== requesterId || req.status !== "open") throw new Error("Nothing to close.");
    const pledges = await d.query<{ id: string; user_id: string; cents: number; source: string; status: string; authorization_id: string | null }>(
      `select id, user_id, cents, source, status, authorization_id from help_pledges where request_id=$1 and status in ('held','pending')`,
      [requestId],
    );
    for (const p of pledges) if (p.source === "paypal" && p.authorization_id && p.status === "held") await voidHold(p.authorization_id).catch(() => undefined);
    await d.tx(async (q) => {
      for (const p of pledges) {
        if (p.source === "jar" && p.status === "held") await move(q, acct.jarHeld(p.user_id), acct.jar(p.user_id), p.cents, { kind: "jar_release", userId: p.user_id, reason: "Nine Lives request closed" });
        await q.query(`update help_pledges set status='voided' where id=$1`, [p.id]);
      }
      await q.query(`update help_requests set status='closed', closed_at=now() where id=$1`, [requestId]);
      await q.query(`update help_asks set status='declined' where request_id=$1 and status='asked'`, [requestId]);
    });
    return { ok: true, released: pledges.length };
  });
}
