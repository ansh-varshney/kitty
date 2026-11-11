import { randomUUID } from "node:crypto";
import { db, type Queryable } from "../db";
import { logEvent } from "./events";
import { acct } from "./ledger";
import { isMember, getUser } from "./users";
import { collect, payFromJar, payOut } from "./money-flow";
import { splitCents } from "../referee/shares";
import { untangle, yarnBalances, type Transfer } from "../referee/yarn";
import { withLock } from "./locks";

/**
 * Yarn: "I paid" cards, who owes whom, and Untangle (PRD §B11, FR-YARN-1..6, AT-13).
 * Each person's part counts as soon as it's agreed, and the two kittens carry the back-and-forth until it is (FR-YARN-7).
 * Squads only ever see "all untangled" or "N open"; amounts appear in personal views (FR-YARN-6).
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const name = async (q: Queryable, id: string) => (await getUser(q, id))?.name ?? "A friend";

export async function logIPaid(
  creatorId: string,
  input: { squadId: string; payerId?: string; cents: number; note: string; forUserIds: string[]; includePayer?: boolean; kind?: "split" | "treat"; amounts?: Record<string, number> },
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
  // Split unequally: the person logging it says what each person's part is, and it has to come to the whole amount.
  const amounts = kind === "split" ? input.amounts : undefined;
  if (amounts) {
    if (sharers.some((u) => !Number.isInteger(amounts[u]) || amounts[u] <= 0)) throw new Error("Put an amount against everyone.");
    if (sharers.reduce((a, u) => a + amounts[u], 0) !== input.cents) throw new Error(`The amounts need to add up to ${fmt(input.cents)}.`);
  }
  const shares = amounts ? sharers.map((u) => amounts[u]) : splitCents(input.cents, sharers.map(() => 1), sharers.map((_, i) => i + 1));
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
      await q.query(`insert into yarn_parts (card_id, user_id, cents, status, waiting_on) values ($1,$2,$3,$4,$5)`, [c.id, u, cents, u === creatorId ? "confirmed" : "pending", u === creatorId ? null : u]);
    }
    const payerName = await name(q, payerId);
    const asked: string[] = [];
    for (const u of parties.filter((x) => x !== creatorId)) {
      const mine = owed.get(u);
      const theirName = await name(q, u);
      asked.push(theirName);
      await kittensSay(q, creatorId, u, kind === "treat" ? `${payerName} treated ${theirName} to ${input.note}. Nothing owed.` : u === payerId ? `${payerName} paid ${fmt(input.cents)} for ${input.note}.` : `${payerName} paid ${fmt(input.cents)} for ${input.note}. ${theirName}'s part is ${fmt(mine ?? 0)}.`);
      await kittensSay(q, u, creatorId, `Got it. I'll check with ${theirName}.`);
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
    await logEvent(q, { userId: creatorId, squadId: input.squadId, actor: "kitten", type: "yarn.asked", objectType: "yarn", objectId: c.id, payload: { cents: input.cents, text: `I told ${asked.join(" and ")}'s ${asked.length > 1 ? "kittens" : "kitten"} about ${fmt(input.cents)} for ${input.note}. I'll tell you what comes back.` }, reason: "you logged an \"I paid\" card" });
    await logEvent(q, { squadId: input.squadId, actor: "user", actorId: creatorId, type: "yarn.card", objectType: "yarn", objectId: c.id, public: { text: `${payerName} logged ${kind === "treat" ? "a treat" : "an \"I paid\" card"} in Yarn.` } });
    return c;
  });
  return { cardId: card.id, kind, shares: Object.fromEntries(owed) };
}

async function kittensSay(q: Queryable, from: string, to: string, text: string) {
  await q.query(`insert into direct_messages (from_user, to_user, from_kind, to_kind, text) values ($1,$2,'kitten','kitten',$3)`, [from, to, text]);
}

type PartRow = { squad_id: string; payer_id: string; created_by: string; total: number; note: string; kind: string; card_status: string; user_id: string; cents: number; status: string; waiting_on: string | null; proposed_cents: number | null; round: number };

async function loadPart(q: Queryable, cardId: string, partUser: string): Promise<PartRow | null> {
  const [r] = await q.query<PartRow>(
    `select c.squad_id, c.payer_id, c.created_by, c.cents as total, c.note, c.kind, c.status as card_status, p.user_id, p.cents, p.status, p.waiting_on, p.proposed_cents, p.round
     from yarn_parts p join yarn_cards c on c.id=p.card_id where p.card_id=$1 and p.user_id=$2`,
    [cardId, partUser],
  );
  return r ?? null;
}

const otherSide = (r: PartRow, actor: string) => (actor !== r.user_id ? r.user_id : r.user_id === r.payer_id ? r.created_by : r.payer_id);

/** The card as a whole: settled once everyone has agreed, paused while anyone is still working it out. */
async function recomputeCard(q: Queryable, cardId: string) {
  const parts = await q.query<{ status: string }>(`select status from yarn_parts where card_id=$1`, [cardId]);
  const status = parts.some((p) => p.status === "disputed" || p.status === "countered") ? "disputed" : parts.every((p) => p.status === "confirmed") ? "confirmed" : "pending";
  await q.query(`update yarn_cards set status=$2 where id=$1 and status <> 'void'`, [cardId, status]);
  return status;
}

/** One tap: "Yes" or "Not right" (FR-YARN-2). */
export async function respondCard(userId: string, cardId: string, ok: boolean) {
  return ok ? agree(userId, cardId, userId) : counterCard(userId, cardId, {});
}

/** Accept what the other side's kitten brought back. */
export async function acceptOffer(actor: string, cardId: string, forUser?: string) {
  return agree(actor, cardId, forUser ?? actor, true);
}

async function agree(actor: string, cardId: string, partUser: string, mustBeYourTurn = false) {
  const result = await withLock(`card:${cardId}:${partUser}`, async () => {
    const d = await db();
    const r = await loadPart(d, cardId, partUser);
    if (!r) throw new Error("You're not on that card.");
    if (r.card_status === "void") throw new Error("That card was removed.");
    if (r.status === "confirmed") return { status: r.card_status };
    if ((mustBeYourTurn || actor !== r.user_id) && r.waiting_on !== actor) throw new Error("It's their turn on this card.");
    const accepting = r.waiting_on === actor && r.proposed_cents != null;
    const amount = accepting ? r.proposed_cents! : r.cents;
    const other = otherSide(r, actor);
    const actorName = await name(d, actor);
    return d.tx(async (q) => {
      await q.query(`update yarn_parts set cents=$3, status='confirmed', waiting_on=null, proposed_cents=null, offers = offers || $4::jsonb where card_id=$1 and user_id=$2`, [cardId, partUser, amount, JSON.stringify([{ by: actor, cents: amount, agreed: true, at: new Date().toISOString() }])]);
      const status = await recomputeCard(q, cardId);
      await kittensSay(q, actor, other, `${actorName} agreed: ${fmt(amount)} for ${r.note}.`);
      await logEvent(q, { userId: other, squadId: r.squad_id, actor: "kitten", type: "yarn.agreed", objectType: "yarn", objectId: cardId, payload: { cents: amount, text: `${actorName} ${accepting ? "accepted" : "confirmed"} ${fmt(amount)} for ${r.note}.` }, reason: `${actorName}'s kitten told me` });
      return { status, amount, debtor: r.user_id !== r.payer_id ? r.user_id : null, payer: r.payer_id, squadId: r.squad_id, note: r.note, kind: r.kind };
    });
  });
  if (!("amount" in result) || !result.debtor || !result.amount || result.kind === "treat") return { status: result.status };
  return { status: result.status, ...(await settleAgreed(cardId, result.debtor, result.payer, result.amount, result.squadId, result.note)) };
}

/**
 * Agreed, so the debtor's kitten settles it (owner, 9 Nov): from the Treat Jar if it's allowed to, otherwise it asks.
 * Demo friends exist only in tests and the dev console, where payments stay explicit so runs are predictable.
 */
async function settleAgreed(cardId: string, debtor: string, payer: string, cents: number, squadId: string, note: string) {
  const d = await db();
  const person = await getUser(d, debtor);
  if (!person || person.is_demo) return {};
  return withLock(`yarn:${squadId}`, async () => {
    const [s] = await d.query<{ id: string }>(`insert into yarn_settlements (squad_id, untangle_id, from_user, to_user, cents, card_id, note) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [squadId, randomUUID(), debtor, payer, cents, cardId, note]);
    if (await payFromJar(debtor, cents, acct.yarn(squadId), { kind: "yarn", squadId, ledgerKind: "yarn_pay", reason: `settling ${note}` })) {
      await finishSettlement(s.id, "jar", null);
      return { paid: true, via: "jar" as const, settlementId: s.id };
    }
    return { paid: false, settlementId: s.id };
  });
}

/** What a typed reply says about money: "$10", "should be 10", "nothing". Null when it gives no amount. */
function amountIn(text: string): number | null {
  const m = /\$\s*(\d+(?:\.\d{1,2})?)/.exec(text) ?? /\b(?:be|is|was|only|pay|owe|make it)\s+(\d+(?:\.\d{1,2})?)\b/i.exec(text) ?? /^\s*(\d+(?:\.\d{1,2})?)\s*$/.exec(text);
  if (m) return Math.round(Number(m[1]) * 100);
  return /\b(nothing|zero)\b/i.test(text) ? 0 : null;
}

/** "Not right": your kitten carries your number, or your objection, to the other side's kitten. */
export async function counterCard(actor: string, cardId: string, input: { text?: string; cents?: number; forUser?: string }) {
  const partUser = input.forUser ?? actor;
  const again = await withLock(`card:${cardId}:${partUser}`, async () => {
    const d = await db();
    const r = await loadPart(d, cardId, partUser);
    if (!r) throw new Error("You're not on that card.");
    if (r.card_status === "void") throw new Error("That card was removed.");
    if (r.card_status === "confirmed" || r.status === "confirmed") throw new Error(`Everyone already confirmed this card. Ask ${await name(d, r.created_by)} to fix or remove it.`);
    if (r.waiting_on !== actor) throw new Error("It's their turn on this card.");
    const typed = (input.text ?? "").trim().slice(0, 200);
    const amount = input.cents ?? (typed ? amountIn(typed) : null);
    // The reason on its own: "$10, I only had a salad" is $10 because "I only had a salad".
    const why = typed.replace(/^\s*\$?\s*\d+(?:\.\d{1,2})?\s*[,:;.-]*\s*/, "");
    if (amount != null && amount > r.total) throw new Error(`That's more than the whole card (${fmt(r.total)}).`);
    // Named the same number the other side offered: that's a yes.
    if (amount != null && r.proposed_cents != null && amount === r.proposed_cents) return true;
    const other = otherSide(r, actor);
    const actorName = await name(d, actor);
    const otherName = await name(d, other);
    const current = r.proposed_cents ?? r.cents;
    const said = amount != null ? `${actorName} says it should be ${fmt(amount)}, not ${fmt(current)}, for ${r.note}.` : `${actorName} says ${r.note} isn't right.`;
    const because = why ? ` "${why}"` : "";
    await d.tx(async (q) => {
      await q.query(`update yarn_parts set status=$3, proposed_cents=$4, waiting_on=$5, round=round+1, offers = offers || $6::jsonb where card_id=$1 and user_id=$2`, [cardId, partUser, amount != null ? "countered" : "disputed", amount, other, JSON.stringify([{ by: actor, cents: amount, why, at: new Date().toISOString() }])]);
      await recomputeCard(q, cardId);
      await kittensSay(q, actor, other, `${said}${because}`);
      await kittensSay(q, other, actor, `Got it. I'll ask ${otherName}.`);
      await logEvent(q, { userId: other, squadId: r.squad_id, actor: "kitten", type: "yarn.disputed", objectType: "yarn", objectId: cardId, payload: { text: `${said}${because}` } });
      await logEvent(q, { userId: actor, squadId: r.squad_id, actor: "kitten", type: "yarn.countered", objectType: "yarn", objectId: cardId, payload: { text: `I told ${otherName}'s kitten${amount != null ? ` it should be ${fmt(amount)}` : " it isn't right"} for ${r.note}. I'll tell you what comes back.` }, reason: "you asked me to change it" });
    });
    return false;
  });
  if (again) return acceptOffer(actor, cardId, input.forUser);
  return { status: "disputed" };
}

export type Turn = { card_id: string; note: string; total: number; kind: string; payer_id: string; created_by: string; squad_id: string; part_user: string; cents: number; status: string; proposed_cents: number | null; round: number; offers: { by: string; cents: number | null; why?: string }[]; payer_name: string; debtor_name: string; creator_name: string };

/** Every card waiting on this person right now. */
export async function cardTurns(q: Queryable, userId: string, squadId?: string): Promise<Turn[]> {
  return q.query<Turn>(
    `select c.id as card_id, c.note, c.cents as total, c.kind, c.payer_id, c.created_by, c.squad_id, p.user_id as part_user, p.cents, p.status, p.proposed_cents, p.round, p.offers,
            pu.name as payer_name, du.name as debtor_name, cu.name as creator_name
     from yarn_parts p join yarn_cards c on c.id=p.card_id join users pu on pu.id=c.payer_id join users du on du.id=p.user_id join users cu on cu.id=c.created_by
     where p.waiting_on=$1 and p.status in ('pending','countered','disputed') and c.status <> 'void' and ($2::uuid is null or c.squad_id=$2) order by c.created_at, p.user_id`,
    [userId, squadId ?? null],
  );
}

const POST = "POST" as const;

/** The card your kitten shows you: the same one in its chat, in Meows and in Settle up. */
export function turnItem(t: Turn, userId: string) {
  const base = `yarn/cards/${t.card_id}`;
  const body = t.part_user === userId ? {} : { forUser: t.part_user };
  const theirName = t.part_user === userId ? (t.part_user === t.payer_id ? t.creator_name : t.payer_name) : t.debtor_name;
  const last = t.offers.at(-1);
  const because = last?.why ? ` "${last.why}"` : "";
  const onTable = t.proposed_cents ?? t.cents;
  const counter = { method: POST, path: `${base}/counter`, body, field: "text" };
  const keep = t.proposed_cents !== t.cents && t.part_user !== userId ? [{ label: `Keep ${fmt(t.cents)}`, action: { method: POST, path: `${base}/counter`, body: { ...body, cents: t.cents } } }] : [];
  const common = { key: `card:${t.card_id}:${t.part_user}:${t.round}`, card: { id: t.card_id } };
  if (t.status === "pending") {
    const text = t.kind === "treat" ? `${t.payer_name} treated you: ${t.note}. Nothing owed. Is that right?` : t.part_user === t.payer_id ? `${t.creator_name} says you paid ${fmt(t.total)} for ${t.note}. Is that right?` : `${t.payer_name} paid ${fmt(t.total)} for ${t.note}. Your part: ${fmt(t.cents)}. Is that right?`;
    return { ...common, text, action: { method: POST, path: `${base}/confirm` }, choices: [{ label: "Yes, that's right", action: { method: POST, path: `${base}/confirm` } }], reply: counter, replyLabel: "Not right", replyHint: "What should it be? $10, I only had a salad" };
  }
  if (t.status === "countered")
    return { ...common, text: `${theirName} says ${t.note} should be ${fmt(onTable)}, not ${fmt(t.cents)}.${because} OK?`, action: { method: POST, path: `${base}/accept`, body }, choices: [{ label: `Accept ${fmt(onTable)}`, action: { method: POST, path: `${base}/accept`, body } }, ...keep], reply: counter, replyLabel: "Suggest another amount", replyHint: "$12, because I had a drink too" };
  return { ...common, text: `${theirName} says ${t.note} (${fmt(t.cents)}) isn't right.${because} What should it be?`, choices: keep, reply: counter, replyLabel: "Suggest an amount", replyHint: "$12" };
}

const PART_WORDS: Record<string, string> = { pending: "Hasn't answered", confirmed: "Agreed", disputed: "Says it isn't right", countered: "Working it out" };

/** The card itself, with how it got to where it is. You see your own part; whoever paid or logged it sees everyone's. */
export async function cardView(userId: string, cardId: string) {
  const d = await db();
  const [c] = await d.query<{ id: string; note: string; cents: number; kind: string; status: string; created_at: string; payer_id: string; created_by: string; payer_name: string; squad: string }>(
    `select c.id, c.note, c.cents, c.kind, c.status, c.created_at, c.payer_id, c.created_by, u.name as payer_name, s.name as squad from yarn_cards c join users u on u.id=c.payer_id join squads s on s.id=c.squad_id where c.id=$1`,
    [cardId],
  );
  if (!c) throw new Error("That card isn't here any more.");
  const parts = await d.query<{ user_id: string; name: string; cents: number; status: string; proposed_cents: number | null; offers: { by: string; cents: number | null; why?: string; agreed?: boolean; at: string }[] }>(
    `select p.user_id, u.name, p.cents, p.status, p.proposed_cents, p.offers from yarn_parts p join users u on u.id=p.user_id where p.card_id=$1 order by u.name`,
    [cardId],
  );
  const mine = parts.find((p) => p.user_id === userId);
  const seesAll = c.payer_id === userId || c.created_by === userId;
  if (!seesAll && !mine) throw new Error("You're not on that card.");
  const nameOf = (id: string) => (id === userId ? "You" : id === c.payer_id ? c.payer_name : (parts.find((p) => p.user_id === id)?.name ?? "Someone"));
  const history = (seesAll ? parts : [mine!])
    .flatMap((p) => p.offers)
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((o) => ({ at: o.at, text: o.agreed ? `${nameOf(o.by)} agreed to ${fmt(o.cents ?? 0)}.` : o.cents != null ? `${nameOf(o.by)} said ${fmt(o.cents)}.${o.why ? ` "${o.why}"` : ""}` : `${nameOf(o.by)} said it isn't right.${o.why ? ` "${o.why}"` : ""}` }));
  return {
    id: c.id,
    note: c.note,
    totalCents: c.cents,
    kind: c.kind,
    status: c.status,
    createdAt: c.created_at,
    squad: c.squad,
    payerName: c.payer_name,
    paidByMe: c.payer_id === userId,
    myCents: mine && mine.user_id !== c.payer_id ? mine.cents : null,
    people: parts.filter((p) => p.user_id !== c.payer_id).map((p) => ({ name: p.name, word: PART_WORDS[p.status] ?? p.status, cents: seesAll ? p.cents : null })),
    history,
    turns: (await cardTurns(d, userId)).filter((t) => t.card_id === cardId).map((t) => turnItem(t, userId)),
  };
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
      const counted = await q.query(`select 1 from yarn_parts where card_id=$1 and status='confirmed' and cents > 0 limit 1`, [cardId]);
      if (counted.length) voided = await voidOpenSettlements(q, c.squad_id, `the "${c.note}" card was removed`);
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
    // Only the wording changed: everyone's part stays exactly as it was, even if it wasn't an even split.
    amounts: c.kind === "split" && input.cents == null && !input.forUserIds && input.includePayer === undefined ? { ...Object.fromEntries(parts.map((p) => [p.user_id, p.cents])), ...(owedSum === c.cents ? {} : { [c.payer_id]: c.cents - owedSum }) } : undefined,
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
  // The amounts need working out again, so the weekly Untangle has to pick these cards back up.
  if (open.length) await q.query(`update yarn_cards set untangled_at=null where squad_id=$1 and status='confirmed'`, [squadId]);
  return open.length;
}

async function squadState(q: Queryable, squadId: string) {
  const parts = await q.query<{ card_id: string; payer_id: string; user_id: string; cents: number }>(
    `select c.id as card_id, c.payer_id, p.user_id, p.cents from yarn_cards c join yarn_parts p on p.card_id=c.id
     where c.squad_id=$1 and c.status <> 'void' and p.status='confirmed'`,
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
/** "I paid" cards you logged that friends haven't all agreed to yet (F29, F30). */
export async function myOpenCards(userId: string, squadId: string) {
  const d = await db();
  const cards = await d.query<{ id: string; note: string; cents: number; status: string }>(
    `select id, note, cents, status from yarn_cards where squad_id=$1 and created_by=$2 and status in ('pending','disputed') and kind <> 'loan' order by created_at desc`,
    [squadId, userId],
  );
  return Promise.all(
    cards.map(async (c) => {
      const parts = await d.query<{ name: string; status: string }>(`select u.name, p.status from yarn_parts p join users u on u.id=p.user_id where p.card_id=$1 and p.user_id <> $2`, [c.id, userId]);
      return { ...c, waitingOn: parts.filter((p) => p.status === "pending").map((p) => p.name), notRight: parts.filter((p) => p.status === "disputed" || p.status === "countered").map((p) => p.name) };
    }),
  );
}

export async function myYarn(userId: string) {
  const d = await db();
  const squads = await d.query<{ id: string; name: string }>(
    `select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 and m.left_at is null and s.kind <> 'gift'`,
    [userId],
  );
  const out = [];
  for (const s of squads) out.push(await yarnLine(d, s, userId));
  return out;
}

/** One group's Yarn as one person sees it: their balance, the strands behind it, their open payments, cards to answer. */
export async function yarnLine(d: Queryable, s: { id: string; name: string }, userId: string) {
  const b = await squadState(d, s.id);
  const mine = b[userId] ?? 0;
  const settlements = await d.query<{ id: string; from_user: string; to_user: string; cents: number; status: string; paid_via: string | null }>(
    `select id, from_user, to_user, cents, status, paid_via from yarn_settlements where squad_id=$1 and status='open' and (from_user=$2 or to_user=$2)`,
    [s.id, userId],
  );
  const pending = (await cardTurns(d, userId, s.id)).map((t) => ({ id: t.card_id, note: t.note, item: turnItem(t, userId) }));
  const waiting = await d.query<{ card_id: string; note: string; cents: number; other: string }>(
    `select c.id as card_id, c.note, coalesce(p.proposed_cents, p.cents) as cents, u.name as other from yarn_parts p join yarn_cards c on c.id=p.card_id join users u on u.id=p.waiting_on
     where c.squad_id=$1 and c.status <> 'void' and (p.user_id=$2 or c.payer_id=$2) and p.waiting_on <> $2 and p.status in ('countered','disputed')`,
    [s.id, userId],
  );
  // The strands behind the balance: confirmed cards between me and someone else since I last settled up here.
  let strands: { note: string; text: string; cents: number; iOwe: boolean }[] = [];
  if (mine !== 0) {
    const rows = await d.query<{ note: string; payer_id: string; payer: string; user_id: string; person: string; cents: number }>(
      `select c.note, c.payer_id, pu.name as payer, p.user_id, ou.name as person, p.cents
       from yarn_cards c join yarn_parts p on p.card_id=c.id join users pu on pu.id=c.payer_id join users ou on ou.id=p.user_id
       where c.squad_id=$1 and c.status <> 'void' and p.status='confirmed' and p.cents > 0 and p.user_id <> c.payer_id and (c.payer_id=$2 or p.user_id=$2)
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
  return { squadId: s.id, squad: s.name, youOweCents: mine < 0 ? -mine : 0, owedToYouCents: mine > 0 ? mine : 0, strands, settlements, toConfirm: pending, waiting };
}

/** Untangle: the fewest payments that settle the squad (FR-YARN-3). Replaces any earlier unpaid plan. */
export async function runUntangle(byUserId: string, squadId: string) {
  return withLock(`yarn:${squadId}`, () => runUntangleNow(byUserId, squadId));
}

/** Who pays whom in this group if it were untangled now. Changes nothing. */
export async function untanglePlan(q: Queryable, squadId: string) {
  return untangle(await squadState(q, squadId));
}

/** From My Month. It also works for a group someone has left: then the kittens run it rather than a member. */
export async function untangleGroup(userId: string, squadId: string) {
  return withLock(`yarn:${squadId}`, async () => runUntangleNow((await isMember(await db(), squadId, userId)) ? userId : null, squadId));
}

/** `byUserId` is null when the kittens run it on their own (FR-REMIND-5). */
async function runUntangleNow(byUserId: string | null, squadId: string) {
  const d = await db();
  if (byUserId && !(await isMember(d, squadId, byUserId))) throw new Error("You're not in that squad.");
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
    await q.query(`update yarn_cards set untangled_at=now() where squad_id=$1 and status='confirmed' and untangled_at is null`, [squadId]);
    const payments = `${t.length} payment${t.length > 1 ? "s" : ""}`;
    await logEvent(q, {
      squadId,
      ...(byUserId ? { actor: "user" as const, actorId: byUserId } : { actor: "system" as const }),
      type: "yarn.untangle",
      public: { text: !t.length ? "Yarn is all untangled." : byUserId ? `Yarn untangled into ${payments}.` : `The kittens untangled the Yarn into ${payments}.` },
    });
    return t;
  });
  return { untangleId, transfers };
}

/**
 * Pay my part of an Untangle: from the Treat Jar if within my free hand, else PayPal (FR-YARN-4). The money passes
 * through the squad's yarn pot and goes straight on to the person owed by Payout.
 */
export async function paySettlement(userId: string, settlementId: string, refill?: boolean) {
  const d = await db();
  const [s0] = await d.query<{ squad_id: string }>(`select squad_id from yarn_settlements where id=$1`, [settlementId]);
  if (!s0) throw new Error("That payment isn't yours.");
  // One at a time per squad: a double tap, or an Untangle redone mid-payment, must not charge twice (edge case C6).
  return withLock(`yarn:${s0.squad_id}`, () => paySettlementNow(userId, settlementId, refill));
}

async function paySettlementNow(userId: string, settlementId: string, refill?: boolean) {
  const d = await db();
  const [s] = await d.query<{ squad_id: string; from_user: string; to_user: string; cents: number; status: string; paid_via: string | null }>(
    `select squad_id, from_user, to_user, cents, status, paid_via from yarn_settlements where id=$1`,
    [settlementId],
  );
  if (!s || s.from_user !== userId) throw new Error("That payment isn't yours.");
  if (s.status === "paid") throw new Error("Already paid.");
  if (s.status !== "open") throw new Error("Yarn changed, so this payment was cancelled. Tap Untangle again.");
  const c = await collect(userId, s.cents, acct.yarn(s.squad_id), { ledgerKind: "yarn_pay", reason: `settling up with ${await name(d, s.to_user)}`, after: `yarn:${settlementId}`, refill });
  if (!c.done) return c.next;
  return finishSettlement(settlementId, c.source, c.paypalId);
}

export async function finishSettlement(settlementId: string, via: string, paypalId: string | null) {
  const d = await db();
  const [s] = await d.query<{ squad_id: string; from_user: string; to_user: string; cents: number; note: string | null }>(`select squad_id, from_user, to_user, cents, note from yarn_settlements where id=$1`, [settlementId]);
  const toName = await name(d, s.to_user);
  const forWhat = s.note ? ` for ${s.note}` : "";
  // Money arrived for it (even if an Untangle was redone meanwhile), so it counts as paid, exactly once.
  const claimed = await d.query(`update yarn_settlements set status='paid', paid_via=$2, paypal_id=$3, paid_at=now() where id=$1 and status <> 'paid' returning id`, [settlementId, via, paypalId]);
  if (!claimed.length) return { ok: true, payoutBatchId: null, squad: (await squadYarnSummary(s.squad_id)).text, already: true };
  const batch = await d.tx(async (q) => {
    await logEvent(q, { userId: s.from_user, squadId: s.squad_id, ...(via === "jar" ? { actor: "kitten" as const } : { actor: "user" as const, actorId: s.from_user }), type: "yarn.settled", objectType: "yarn_settlement", objectId: settlementId, payload: { cents: s.cents, via, text: via === "jar" ? `I paid ${toName} ${fmt(s.cents)}${forWhat} from your Treat Jar.` : `Paid ${fmt(s.cents)} to ${toName}${forWhat}. Untangled.` }, reason: via === "jar" ? "you agreed the amount, and it was within your free hand" : undefined, paypalId });
    await kittensSay(q, s.from_user, s.to_user, `Paid ${fmt(s.cents)}${forWhat}.`);
    return payOut(q, s.to_user, s.cents, acct.yarn(s.squad_id), { note: "Yarn untangled", itemId: `yarn-${settlementId.slice(0, 8)}` });
  });
  if (batch) {
    await d.query(`update yarn_settlements set payout_batch_id=$2 where id=$1`, [settlementId, batch]);
    await logEvent(d, { userId: s.to_user, squadId: s.squad_id, actor: "system", type: "yarn.received", objectType: "yarn_settlement", objectId: settlementId, payload: { cents: s.cents, text: `${fmt(s.cents)}${forWhat} from ${await name(d, s.from_user)} is on its way to your PayPal.` }, paypalId: batch });
  }
  const summary = await squadYarnSummary(s.squad_id);
  if (summary.open === 0) await logEvent(d, { squadId: s.squad_id, actor: "system", type: "yarn.clear", public: { text: "Yarn is all untangled." } });
  return { ok: true, payoutBatchId: batch, squad: summary.text };
}

/**
 * The weekly Untangle (FR-REMIND-5): a confirmed card that has waited a week gets untangled without anyone tapping.
 * It only works out who pays whom; no money moves until each person taps Pay. An open payment holds it back.
 */
export async function autoUntangleDue(now = new Date()) {
  const d = await db();
  const due = await d.query<{ id: string }>(
    `select s.id from squads s where s.kind <> 'gift'
       and not exists (select 1 from yarn_settlements x where x.squad_id=s.id and x.status='open')
       and exists (select 1 from yarn_cards c where c.squad_id=s.id and c.status='confirmed' and c.untangled_at is null and c.created_at <= $1::timestamptz - interval '7 days')`,
    [now.toISOString()],
  );
  let ran = 0;
  for (const s of due) {
    try {
      if (await autoUntangle(s.id)) ran++;
    } catch (e) {
      console.error(`[yarn] weekly untangle failed: ${(e as Error).message}`);
    }
  }
  return ran;
}

async function autoUntangle(squadId: string) {
  return withLock(`yarn:${squadId}`, async () => {
    const d = await db();
    // Checked again inside the lock: someone may have tapped Untangle a moment ago.
    const open = await d.query(`select 1 from yarn_settlements where squad_id=$1 and status='open' limit 1`, [squadId]);
    if (open.length) return false;
    if (!untangle(await squadState(d, squadId)).length) {
      // Nothing to pay (it nets out to zero): don't post "all untangled" every time the timer runs.
      await d.query(`update yarn_cards set untangled_at=now() where squad_id=$1 and status='confirmed' and untangled_at is null`, [squadId]);
      return false;
    }
    await runUntangleNow(null, squadId);
    return true;
  });
}

/** Job: payouts that failed earlier, and the weekly Untangle. Reminders live in reminders.ts. */
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
  return { payoutsRetried: retried, autoUntangled: await autoUntangleDue(now) };
}

export async function cardSquad(cardId: string) {
  const d = await db();
  const [c] = await d.query<{ squad_id: string }>(`select squad_id from yarn_cards where id=$1`, [cardId]);
  return c?.squad_id ?? null;
}
