import { randomUUID } from "node:crypto";
import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct } from "./ledger";
import { isMember, getUser } from "./users";
import { collect, payOut } from "./money-flow";
import { splitCents } from "../referee/shares";
import { untangle, yarnBalances, type Transfer } from "../referee/yarn";
import { withLock } from "./locks";

/**
 * Yarn: "I paid" cards, who owes whom, and Untangle (PRD §B11, FR-YARN-1..6, AT-13).
 * A card counts only when every person on it confirms. Squads only ever see "all untangled" or "N open";
 * amounts appear in personal views (FR-YARN-6).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const name = async (q: Queryable, id: string) => (await getUser(q, id))?.name ?? "A friend";

export async function logIPaid(
  creatorId: string,
  input: { squadId: string; payerId?: string; cents: number; note: string; forUserIds: string[]; includePayer?: boolean; kind?: "split" | "treat" },
) {
  const d = await db();
  const payerId = input.payerId ?? creatorId;
  const kind = input.kind ?? "split";
  input = { ...input, note: (input.note ?? "").trim() };
  if (!input.note) throw new Error("Say what it was for.");
  if (!(await isMember(d, input.squadId, creatorId))) throw new Error("You're not in that squad.");
  const people = [...new Set(input.forUserIds)].filter((u) => u !== payerId);
  if (!people.length) throw new Error("Who was it for?");
  for (const u of [payerId, ...people]) if (!(await isMember(d, input.squadId, u))) throw new Error("Everyone on a card must be in the squad.");
  if (!Number.isInteger(input.cents) || input.cents <= 0) throw new Error("Pick an amount.");

  // Split: the total is shared by everyone named (and the payer, unless they didn't take part).
  const sharers = input.includePayer === false ? people : [payerId, ...people];
  const shares = splitCents(input.cents, sharers.map(() => 1), sharers.map((_, i) => i + 1));
  const owed = new Map(sharers.map((u, i) => [u, shares[i]]));
  const card = await d.tx(async (q) => {
    const [c] = await q.query<{ id: string }>(
      `insert into yarn_cards (squad_id, payer_id, created_by, cents, note, kind) values ($1,$2,$3,$4,$5,$6) returning id`,
      [input.squadId, payerId, creatorId, input.cents, input.note.slice(0, 80), kind],
    );
    // Everyone else on the card confirms; whoever logged it has already said it's right.
    const parties = creatorId === payerId ? people : [...people, payerId];
    for (const u of parties) {
      const cents = u === payerId || kind === "treat" ? 0 : (owed.get(u) ?? 0);
      await q.query(`insert into yarn_parts (card_id, user_id, cents, status) values ($1,$2,$3,$4)`, [c.id, u, cents, u === creatorId ? "confirmed" : "pending"]);
    }
    const payerName = await name(q, payerId);
    for (const u of parties.filter((x) => x !== creatorId)) {
      const mine = owed.get(u);
      await logEvent(q, {
        userId: u,
        squadId: input.squadId,
        actor: "kitten",
        type: "yarn.confirm",
        objectType: "yarn",
        objectId: c.id,
        payload: {
          cardId: c.id,
          text:
            kind === "treat"
              ? `${payerName} treated you: ${input.note}. Nothing owed. Is that right?`
              : u === payerId
                ? `${await name(q, creatorId)} says you paid ${fmt(input.cents)} for ${input.note}. Is that right?`
                : `${payerName} paid ${fmt(input.cents)} for ${input.note}. Your part: ${fmt(mine ?? 0)}. Is that right?`,
        },
        reason: "a friend logged an \"I paid\" card",
      });
    }
    await logEvent(q, { squadId: input.squadId, actor: "user", actorId: creatorId, type: "yarn.card", objectType: "yarn", objectId: c.id, public: { text: `${payerName} logged ${kind === "treat" ? "a treat" : "an \"I paid\" card"} in Yarn.` } });
    return c;
  });
  return { cardId: card.id, kind, shares: Object.fromEntries(owed) };
}

/** One tap: "Yep" or "That's not right" (FR-YARN-2). A card counts once everyone on it has confirmed. */
export async function respondCard(userId: string, cardId: string, ok: boolean) {
  const d = await db();
  const [part] = await d.query<{ status: string }>(`select status from yarn_parts where card_id=$1 and user_id=$2`, [cardId, userId]);
  if (!part) throw new Error("You're not on that card.");
  const [c] = await d.query<{ status: string; created_by: string }>(`select status, created_by from yarn_cards where id=$1`, [cardId]);
  if (c.status === "void") throw new Error("That card was removed.");
  if (c.status === "confirmed") {
    // Everyone agreed and it may already be paid back: no quiet flip to "disputed" (edge case C4).
    if (ok) return { status: "confirmed" };
    throw new Error(`Everyone already confirmed this card. Ask ${await name(d, c.created_by)} to fix or remove it.`);
  }
  return d.tx(async (q) => {
    await q.query(`update yarn_parts set status=$3 where card_id=$1 and user_id=$2`, [cardId, userId, ok ? "confirmed" : "disputed"]);
    const parts = await q.query<{ status: string }>(`select status from yarn_parts where card_id=$1`, [cardId]);
    const status = parts.some((p) => p.status === "disputed") ? "disputed" : parts.every((p) => p.status === "confirmed") ? "confirmed" : "pending";
    await q.query(`update yarn_cards set status=$2 where id=$1 and status <> 'void'`, [cardId, status]);
    const [card] = await q.query<{ created_by: string; squad_id: string; note: string }>(`select created_by, squad_id, note from yarn_cards where id=$1`, [cardId]);
    if (!ok) {
      await logEvent(q, { userId: card.created_by, squadId: card.squad_id, actor: "kitten", type: "yarn.disputed", objectType: "yarn", objectId: cardId, payload: { text: `${await name(q, userId)} says the "${card.note}" card isn't right. It's paused until you fix it.` } });
    }
    return { status };
  });
}

/**
 * Remove a card (edge-case pass, 8 Nov): whoever logged it, or the payer, can take it back at any time. It leaves
 * everyone's "Needs you"; if it was counted in an Untangle that isn't paid yet, those payments are cancelled (tap
 * Untangle again). If it was already paid back, the balance now shows that honestly: the payer owes it back.
 * A Nine Lives loan isn't removed this way: the lender turns it into a gift instead.
 */
export async function removeCard(userId: string, cardId: string) {
  const d = await db();
  const [c] = await d.query<{ squad_id: string; payer_id: string; created_by: string; status: string; kind: string; note: string }>(
    `select squad_id, payer_id, created_by, status, kind, note from yarn_cards where id=$1`,
    [cardId],
  );
  if (!c || (c.created_by !== userId && c.payer_id !== userId)) throw new Error("Only the person who logged it (or who paid) can remove it.");
  if (c.kind === "loan") throw new Error("A Nine Lives loan can't be removed. The lender can turn it into a gift.");
  if (c.status === "void") throw new Error("That card was already removed.");
  return withLock(`yarn:${c.squad_id}`, async () => {
    const parts = await d.query<{ user_id: string }>(`select user_id from yarn_parts where card_id=$1 and user_id<>$2`, [cardId, userId]);
    let voided = 0;
    await d.tx(async (q) => {
      await q.query(`update yarn_cards set status='void' where id=$1`, [cardId]);
      if (c.status === "confirmed") voided = await voidOpenSettlements(q, c.squad_id, `the "${c.note}" card was removed`);
      for (const p of parts) {
        await logEvent(q, { userId: p.user_id, squadId: c.squad_id, actor: "kitten", type: "yarn.removed", objectType: "yarn", objectId: cardId, payload: { text: `${await name(q, userId)} removed the "${c.note}" card. Nothing to do.` } });
      }
    });
    return { ok: true, settlementsCancelled: voided };
  });
}

/** Fix a card: the old one is removed and a corrected one goes out for everyone to confirm again. */
export async function editCard(userId: string, cardId: string, input: { cents?: number; note?: string; forUserIds?: string[]; includePayer?: boolean }) {
  const d = await db();
  const [c] = await d.query<{ squad_id: string; payer_id: string; created_by: string; status: string; kind: "split" | "treat" | "loan"; note: string; cents: number }>(
    `select squad_id, payer_id, created_by, status, kind, note, cents from yarn_cards where id=$1`,
    [cardId],
  );
  if (!c || c.created_by !== userId) throw new Error("Only the person who logged it can fix it.");
  if (c.kind === "loan") throw new Error("A Nine Lives loan can't be changed.");
  if (c.status === "void") throw new Error("That card was removed.");
  const parts = await d.query<{ user_id: string; cents: number }>(`select user_id, cents from yarn_parts where card_id=$1 and user_id<>$2`, [cardId, c.payer_id]);
  const owedSum = parts.reduce((a, p) => a + p.cents, 0);
  const next = {
    squadId: c.squad_id,
    payerId: c.payer_id,
    cents: input.cents ?? c.cents,
    note: input.note ?? c.note,
    forUserIds: input.forUserIds ?? parts.map((p) => p.user_id),
    // The payer's own share isn't stored; if the others owed the whole amount, the payer wasn't part of the split.
    includePayer: input.includePayer ?? !(c.kind === "split" && owedSum === c.cents),
    kind: c.kind as "split" | "treat",
  };
  await removeCard(userId, cardId);
  return logIPaid(userId, next);
}

/** Cancel an Untangle's unpaid payments (the balances changed under them); each payer is told privately. */
async function voidOpenSettlements(q: Queryable, squadId: string, why: string) {
  const open = await q.query<{ id: string; from_user: string }>(`select id, from_user from yarn_settlements where squad_id=$1 and status='open'`, [squadId]);
  for (const s of open) {
    await q.query(`update yarn_settlements set status='void' where id=$1`, [s.id]);
    await logEvent(q, { userId: s.from_user, squadId, actor: "kitten", type: "yarn.untangle_cancelled", objectType: "yarn_settlement", objectId: s.id, payload: { text: `Yarn changed (${why}), so that payment is cancelled. Tap Untangle again for the new amounts.` } });
  }
  return open.length;
}

async function squadState(q: Queryable, squadId: string) {
  const parts = await q.query<{ card_id: string; payer_id: string; user_id: string; cents: number }>(
    `select c.id as card_id, c.payer_id, p.user_id, p.cents from yarn_cards c join yarn_parts p on p.card_id=c.id
     where c.squad_id=$1 and c.status='confirmed'`,
    [squadId],
  );
  const byCard = new Map<string, { payer: string; parts: { user: string; cents: number }[] }>();
  for (const p of parts) {
    const card = byCard.get(p.card_id) ?? { payer: p.payer_id, parts: [] };
    card.parts.push({ user: p.user_id, cents: p.cents });
    byCard.set(p.card_id, card);
  }
  const paid = await q.query<{ from_user: string; to_user: string; cents: number }>(`select from_user, to_user, cents from yarn_settlements where squad_id=$1 and status='paid'`, [squadId]);
  return yarnBalances([...byCard.values()], paid.map((t) => ({ from: t.from_user, to: t.to_user, cents: t.cents })));
}

/** Where one person stands in a squad's Yarn: their balance and any Untangle payment still open to or from them. */
export async function yarnPosition(q: Queryable, squadId: string, userId: string) {
  const b = await squadState(q, squadId);
  const open = await q.query(`select 1 from yarn_settlements where squad_id=$1 and status='open' and (from_user=$2 or to_user=$2)`, [squadId, userId]);
  const pending = await q.query(
    `select 1 from yarn_cards c join yarn_parts p on p.card_id=c.id where c.squad_id=$1 and c.status='pending' and (c.payer_id=$2 or p.user_id=$2) limit 1`,
    [squadId, userId],
  );
  return { balanceCents: b[userId] ?? 0, openPayments: open.length, pendingCards: pending.length };
}

/** Squad view: only "all untangled" or "N open" (FR-YARN-6). */
export async function squadYarnSummary(squadId: string) {
  const d = await db();
  const b = await squadState(d, squadId);
  const open = Object.values(b).filter((c) => c < 0).length;
  return { open, text: open ? `${open} open` : "All untangled" };
}

/** Personal view: what I owe / am owed, per squad, with my open settlements. */
export async function myYarn(userId: string) {
  const d = await db();
  const squads = await d.query<{ id: string; name: string }>(
    `select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 and m.left_at is null and s.kind <> 'gift'`,
    [userId],
  );
  const out = [];
  for (const s of squads) {
    const b = await squadState(d, s.id);
    const mine = b[userId] ?? 0;
    const settlements = await d.query<{ id: string; from_user: string; to_user: string; cents: number; status: string }>(
      `select id, from_user, to_user, cents, status from yarn_settlements where squad_id=$1 and status='open' and (from_user=$2 or to_user=$2)`,
      [s.id, userId],
    );
    const pending = await d.query<{ id: string; note: string }>(
      `select c.id, c.note from yarn_cards c join yarn_parts p on p.card_id=c.id where c.squad_id=$1 and p.user_id=$2 and p.status='pending'`,
      [s.id, userId],
    );
    // The strands behind the balance: confirmed cards between me and someone else since I last settled up here.
    let strands: { note: string; text: string; cents: number; iOwe: boolean }[] = [];
    if (mine !== 0) {
      const rows = await d.query<{ note: string; payer_id: string; payer: string; user_id: string; person: string; cents: number }>(
        `select c.note, c.payer_id, pu.name as payer, p.user_id, ou.name as person, p.cents
         from yarn_cards c join yarn_parts p on p.card_id=c.id join users pu on pu.id=c.payer_id join users ou on ou.id=p.user_id
         where c.squad_id=$1 and c.status='confirmed' and p.cents > 0 and p.user_id <> c.payer_id and (c.payer_id=$2 or p.user_id=$2)
           and c.created_at > coalesce((select max(paid_at) from yarn_settlements where squad_id=$1 and status='paid' and (from_user=$2 or to_user=$2)), '-infinity'::timestamptz)
         order by c.created_at desc limit 10`,
        [s.id, userId],
      );
      strands = rows.map((r) =>
        r.user_id === userId
          ? { note: r.note, cents: r.cents, iOwe: true, text: `You owe ${r.payer} ${fmt(r.cents)} for ${r.note}.` }
          : { note: r.note, cents: r.cents, iOwe: false, text: `${r.person} owes you ${fmt(r.cents)} for ${r.note}.` },
      );
    }
    out.push({ squadId: s.id, squad: s.name, youOweCents: mine < 0 ? -mine : 0, owedToYouCents: mine > 0 ? mine : 0, strands, settlements, toConfirm: pending });
  }
  return out;
}

/** Untangle: the fewest payments that settle the squad (FR-YARN-3). Replaces any earlier unpaid plan. */
export async function runUntangle(byUserId: string, squadId: string) {
  return withLock(`yarn:${squadId}`, () => runUntangleNow(byUserId, squadId));
}

async function runUntangleNow(byUserId: string, squadId: string) {
  const d = await db();
  if (!(await isMember(d, squadId, byUserId))) throw new Error("You're not in that squad.");
  // Someone is paying through PayPal right now: redoing the plan would throw their payment away (edge case C7).
  const paying = await d.query(`select 1 from yarn_settlements where squad_id=$1 and status='open' and paid_via='paypal_pending' limit 1`, [squadId]);
  if (paying.length) throw new Error("Someone is paying their part right now. Try Untangle again in a minute.");
  const untangleId = randomUUID();
  const transfers: Transfer[] = await d.tx(async (q) => {
    await q.query(`update yarn_settlements set status='void' where squad_id=$1 and status='open'`, [squadId]);
    const t = untangle(await squadState(q, squadId));
    const [squad] = await q.query<{ name: string }>(`select name from squads where id=$1`, [squadId]);
    for (const x of t) {
      const [s] = await q.query<{ id: string }>(
        `insert into yarn_settlements (squad_id, untangle_id, from_user, to_user, cents) values ($1,$2,$3,$4,$5) returning id`,
        [squadId, untangleId, x.from, x.to, x.cents],
      );
      await logEvent(q, { userId: x.from, squadId, actor: "kitten", type: "yarn.pay", objectType: "yarn_settlement", objectId: s.id, payload: { settlementId: s.id, cents: x.cents, text: `Pay ${fmt(x.cents)} to ${await name(q, x.to)} to untangle ${squad.name}.` }, reason: "Untangle found the fewest payments" });
      await logEvent(q, { userId: x.to, squadId, actor: "kitten", type: "yarn.incoming", objectType: "yarn_settlement", objectId: s.id, payload: { cents: x.cents, text: `${await name(q, x.from)} will pay you ${fmt(x.cents)} to untangle ${squad.name}.` } });
    }
    await logEvent(q, { squadId, actor: "user", actorId: byUserId, type: "yarn.untangle", public: { text: t.length ? `Yarn untangled into ${t.length} payment${t.length > 1 ? "s" : ""}.` : "Yarn is all untangled." } });
    return t;
  });
  return { untangleId, transfers };
}

/**
 * Pay my part of an Untangle: from the Treat Jar if within my free hand, else PayPal (FR-YARN-4). The money passes
 * through the squad's yarn pot and goes straight on to the person owed by Payout.
 */
export async function paySettlement(userId: string, settlementId: string) {
  const d = await db();
  const [s0] = await d.query<{ squad_id: string }>(`select squad_id from yarn_settlements where id=$1`, [settlementId]);
  if (!s0) throw new Error("That payment isn't yours.");
  // One at a time per squad: a double tap, or an Untangle redone mid-payment, must not charge twice (edge case C6).
  return withLock(`yarn:${s0.squad_id}`, () => paySettlementNow(userId, settlementId));
}

async function paySettlementNow(userId: string, settlementId: string) {
  const d = await db();
  const [s] = await d.query<{ squad_id: string; from_user: string; to_user: string; cents: number; status: string; paid_via: string | null }>(
    `select squad_id, from_user, to_user, cents, status, paid_via from yarn_settlements where id=$1`,
    [settlementId],
  );
  if (!s || s.from_user !== userId) throw new Error("That payment isn't yours.");
  if (s.status === "paid") throw new Error("Already paid.");
  if (s.status !== "open") throw new Error("Yarn changed, so this payment was cancelled. Tap Untangle again.");
  const c = await collect(userId, s.cents, acct.yarn(s.squad_id), { kind: "yarn", squadId: s.squad_id, ledgerKind: "yarn_pay", reason: "settling Yarn", customId: `yarn:${settlementId}` });
  if (!c.done) {
    await d.query(`update yarn_settlements set paid_via='paypal_pending' where id=$1`, [settlementId]);
    return { ok: true, approveUrl: c.approveUrl };
  }
  return finishSettlement(settlementId, c.source, c.paypalId);
}

export async function finishSettlement(settlementId: string, via: string, paypalId: string | null) {
  const d = await db();
  const [s] = await d.query<{ squad_id: string; from_user: string; to_user: string; cents: number }>(`select squad_id, from_user, to_user, cents from yarn_settlements where id=$1`, [settlementId]);
  const toName = await name(d, s.to_user);
  // Money arrived for it (even if an Untangle was redone meanwhile), so it counts as paid, exactly once.
  const claimed = await d.query(`update yarn_settlements set status='paid', paid_via=$2, paypal_id=$3, paid_at=now() where id=$1 and status <> 'paid' returning id`, [settlementId, via, paypalId]);
  if (!claimed.length) return { ok: true, payoutBatchId: null, squad: (await squadYarnSummary(s.squad_id)).text, already: true };
  const batch = await d.tx(async (q) => {
    await logEvent(q, { userId: s.from_user, squadId: s.squad_id, actor: "user", actorId: s.from_user, type: "yarn.settled", objectType: "yarn_settlement", objectId: settlementId, payload: { cents: s.cents, via, text: `Paid ${fmt(s.cents)} to ${toName}. Untangled.` }, paypalId });
    return payOut(q, s.to_user, s.cents, acct.yarn(s.squad_id), { note: "Yarn untangled", itemId: `yarn-${settlementId.slice(0, 8)}` });
  });
  if (batch) {
    await d.query(`update yarn_settlements set payout_batch_id=$2 where id=$1`, [settlementId, batch]);
    await logEvent(d, { userId: s.to_user, squadId: s.squad_id, actor: "system", type: "yarn.received", objectType: "yarn_settlement", objectId: settlementId, payload: { cents: s.cents, text: `${fmt(s.cents)} from ${await name(d, s.from_user)} is on its way to your PayPal.` }, paypalId: batch });
  }
  const summary = await squadYarnSummary(s.squad_id);
  if (summary.open === 0) await logEvent(d, { squadId: s.squad_id, actor: "system", type: "yarn.clear", public: { text: "Yarn is all untangled." } });
  return { ok: true, payoutBatchId: batch, squad: summary.text };
}

/** Job: payouts that failed earlier, and private reminders after 3 days (FR-YARN-5; quiet hours are checked by the job runner). */
export async function yarnJobs(now = new Date()) {
  const d = await db();
  const unpaidOut = await d.query<{ id: string; squad_id: string; to_user: string; cents: number }>(`select id, squad_id, to_user, cents from yarn_settlements where status='paid' and payout_batch_id is null`);
  let retried = 0;
  for (const s of unpaidOut) {
    const batch = await d.tx((q) => payOut(q, s.to_user, s.cents, acct.yarn(s.squad_id), { note: "Yarn untangled", itemId: `yarn-${s.id.slice(0, 8)}-r` }));
    if (batch) {
      await d.query(`update yarn_settlements set payout_batch_id=$2 where id=$1`, [s.id, batch]);
      retried++;
    }
  }
  const due = await d.query<{ id: string; squad_id: string; from_user: string; to_user: string; cents: number }>(
    `select id, squad_id, from_user, to_user, cents from yarn_settlements where status='open' and reminded_at is null and created_at < $1::timestamptz - interval '3 days'`,
    [now.toISOString()],
  );
  for (const s of due) {
    const [k] = await d.query<{ name: string }>(`select name from kittens where user_id=$1`, [s.to_user]);
    await logEvent(d, { userId: s.from_user, squadId: s.squad_id, actor: "kitten", type: "yarn.reminder", objectType: "yarn_settlement", objectId: s.id, payload: { settlementId: s.id, cents: s.cents, text: `${k?.name ?? "A friend's kitten"} asked me to remind you: ${fmt(s.cents)} to ${await name(d, s.to_user)} is still open.` }, reason: "unpaid for 3 days" });
    await d.query(`update yarn_settlements set reminded_at=now() where id=$1`, [s.id]);
  }
  return { payoutsRetried: retried, reminders: due.length };
}

export async function cardSquad(cardId: string) {
  const d = await db();
  const [c] = await d.query<{ squad_id: string }>(`select squad_id from yarn_cards where id=$1`, [cardId]);
  return c?.squad_id ?? null;
}
