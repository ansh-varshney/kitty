import { db, type Queryable } from "../db";
import { paySettlement, runUntangle, turnItem, untangleGroup, untanglePlan, yarnLine } from "./yarn";
import { getUser } from "./users";
import { jarBalances } from "./month";
import { refillOrAsk } from "./money-flow";
import { remindNow } from "./reminders";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * Settle up (PRD §B20, FR-MONTH-5): one private place in My Month with everything left to settle, across every group
 * the person is or was in: Yarn balances (including Nine Lives loans and missed Bowl shares, which are Yarn), payments
 * ready to pay, payments on their way to them, "I paid" cards waiting for their answer, and extra costs on plans.
 * Only the person's own lines: never what friends owe each other (FR-SEC-10, FR-YARN-6).
 */

export type SettleGroup = {
  squadId: string;
  squad: string;
  /** They left this group, but something is still open there. */
  left: boolean;
  youOweCents: number;
  owedToYouCents: number;
  /** The one thing to do next in this group. */
  next: "pay" | "wait" | "untangle" | "confirm";
  strands: { note: string; text: string; cents: number; iOwe: boolean }[];
  toPay: { settlementId: string; toName: string; cents: number; paying: boolean }[];
  toReceive: { settlementId: string; fromName: string; cents: number }[];
  toConfirm: { cardId: string; note: string; item: ReturnType<typeof turnItem> }[];
  waiting: { cardId: string; note: string; text: string }[];
  canUntangle: boolean;
};

export async function settleUp(userId: string) {
  const d = await db();
  const squads = await d.query<{ id: string; name: string; left_at: string | null }>(
    `select s.id, s.name, m.left_at from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 order by s.created_at`,
    [userId],
  );
  const groups: SettleGroup[] = [];
  for (const s of squads) {
    const line = await yarnLine(d, s, userId);
    const nothing = !line.youOweCents && !line.owedToYouCents && !line.settlements.length && !line.toConfirm.length && !line.waiting.length;
    if (nothing) continue; // only groups with something on them
    const ids = [...new Set(line.settlements.flatMap((x) => [x.from_user, x.to_user]))];
    const people = ids.length ? await d.query<{ id: string; name: string }>(`select id, name from users where id = any($1::uuid[])`, [ids]) : [];
    const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "A friend";
    const toPay = line.settlements.filter((x) => x.from_user === userId).map((x) => ({ settlementId: x.id, toName: nameOf(x.to_user), cents: x.cents, paying: x.paid_via === "paypal_pending" }));
    const toReceive = line.settlements.filter((x) => x.to_user === userId).map((x) => ({ settlementId: x.id, fromName: nameOf(x.from_user), cents: x.cents }));
    const toConfirm = line.toConfirm.map((c) => ({ cardId: c.id, note: c.note, item: c.item }));
    const waiting = line.waiting.map((w) => ({ cardId: w.card_id, note: w.note, text: `${w.note}, ${fmt(w.cents)}: waiting on ${w.other}'s kitten.` }));
    const left = s.left_at != null;
    const hasBalance = line.youOweCents > 0 || line.owedToYouCents > 0;
    const next: SettleGroup["next"] = toPay.length ? "pay" : toReceive.length ? "wait" : hasBalance ? "untangle" : toConfirm.length ? "confirm" : "wait";
    groups.push({
      squadId: s.id,
      squad: s.name,
      left,
      youOweCents: line.youOweCents,
      owedToYouCents: line.owedToYouCents,
      next,
      strands: line.strands,
      toPay,
      toReceive,
      toConfirm,
      waiting,
      canUntangle: !left && next === "untangle",
    });
  }
  // Extra costs after a receipt came in over budget: owed into the plan's pot, not through Yarn (FR-SETTLE-3).
  const planExtras = await d.query<{ plan_id: string; title: string; squad: string; cents: number }>(
    `select p.id as plan_id, p.title, s.name as squad, m.overrun_due_cents as cents
     from plan_members m join plans p on p.id=m.plan_id join squads s on s.id=p.squad_id
     where m.user_id=$1 and m.overrun_due_cents > 0 and not m.overrun_paid and p.status='pounced' order by p.decide_by`,
    [userId],
  );
  const owe = groups.reduce((a, g) => a + g.youOweCents, 0) + planExtras.reduce((a, x) => a + x.cents, 0);
  const owed = groups.reduce((a, g) => a + g.owedToYouCents, 0);
  return {
    totals: { youOweCents: owe, owedToYouCents: owed, netCents: owed - owe, readyToPayCents: groups.flatMap((g) => g.toPay).reduce((a, x) => a + x.cents, 0) },
    groups,
    planExtras,
    allSettled: groups.length === 0 && planExtras.length === 0,
  };
}

/** One tap in My Month: Untangle every group that still needs it. A group that can't right now is reported, not fatal. */
export async function untangleEverything(userId: string) {
  const before = await settleUp(userId);
  const untangled: { squad: string; payments: number }[] = [];
  const skipped: { squad: string; reason: string }[] = [];
  for (const g of before.groups.filter((x) => x.canUntangle)) {
    try {
      const r = await runUntangle(userId, g.squadId);
      untangled.push({ squad: g.squad, payments: r.transfers.length });
    } catch (e) {
      skipped.push({ squad: g.squad, reason: (e as Error).message });
    }
  }
  return { untangled, skipped, settleUp: await settleUp(userId) };
}

export type SettlePerson = { key: string; squadId: string; squad: string; otherId: string; name: string; look: Record<string, unknown> | null; iOwe: boolean; cents: number };

const openBetween = (q: Queryable, squadId: string, a: string, b: string) =>
  q.query<{ id: string; from_user: string; to_user: string; cents: number }>(`select id, from_user, to_user, cents from yarn_settlements where squad_id=$1 and status='open' and ((from_user=$2 and to_user=$3) or (from_user=$3 and to_user=$2)) order by created_at`, [squadId, a, b]);

/**
 * Settle up by person (FR-MONTH-5): who I still owe and who still owes me, one row per person per group. An open payment
 * says it exactly; otherwise it's the fewest-payments plan for that group, the same one Untangle would make.
 */
export async function settlePeople(userId: string): Promise<SettlePerson[]> {
  const d = await db();
  const squads = await d.query<{ id: string; name: string }>(`select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 order by s.created_at`, [userId]);
  const rows: Omit<SettlePerson, "name" | "look">[] = [];
  for (const s of squads) {
    const open = await d.query<{ from_user: string; to_user: string; cents: number }>(`select from_user, to_user, cents from yarn_settlements where squad_id=$1 and status='open' and (from_user=$2 or to_user=$2)`, [s.id, userId]);
    const lines = open.length ? open.map((x) => ({ from: x.from_user, to: x.to_user, cents: x.cents })) : (await untanglePlan(d, s.id)).filter((t) => t.from === userId || t.to === userId);
    const byPerson = new Map<string, number>();
    for (const l of lines) {
      const other = l.from === userId ? l.to : l.from;
      byPerson.set(other, (byPerson.get(other) ?? 0) + (l.from === userId ? -l.cents : l.cents));
    }
    for (const [otherId, net] of byPerson) if (net) rows.push({ key: `${s.id}:${otherId}`, squadId: s.id, squad: s.name, otherId, iOwe: net < 0, cents: Math.abs(net) });
  }
  if (!rows.length) return [];
  const people = await d.query<{ id: string; name: string; look: Record<string, unknown> | null }>(`select u.id, u.name, k.look from users u left join kittens k on k.user_id=u.id where u.id = any($1::uuid[])`, [[...new Set(rows.map((r) => r.otherId))]]);
  return rows.map((r) => ({ ...r, name: people.find((p) => p.id === r.otherId)?.name ?? "A friend", look: people.find((p) => p.id === r.otherId)?.look ?? null }));
}

async function inGroup(q: Queryable, squadId: string, userId: string) {
  if (!(await q.query(`select 1 from memberships where squad_id=$1 and user_id=$2`, [squadId, userId])).length) throw new Error("You're not in that group.");
}

/**
 * Untangle with one person, from My Month. If I owe them, it pays them now from my Treat Jar (a refill if it's short).
 * If they owe me, it sets up their payment, and their kitten asks them to pay.
 */
export async function untangleWith(userId: string, squadId: string, otherId: string, refill?: boolean) {
  const d = await db();
  await inGroup(d, squadId, userId);
  const name = (await getUser(d, otherId))?.name ?? "them";
  let open = await openBetween(d, squadId, userId, otherId);
  if (!open.length) {
    await untangleGroup(userId, squadId);
    open = await openBetween(d, squadId, userId, otherId);
  }
  if (!open.length) return { ok: true as const, status: "nothing", message: `There's nothing left to untangle with ${name}.` };
  const mine = open.filter((s) => s.from_user === userId);
  if (!mine.length) return { ok: true as const, status: "waiting", message: `Untangled. ${name}'s kitten will ask them to pay you ${fmt(open.reduce((a, s) => a + s.cents, 0))}.` };
  const total = mine.reduce((a, s) => a + s.cents, 0);
  if (!(await getUser(d, userId))?.is_demo) {
    const { availableCents } = await jarBalances(d, userId);
    if (availableCents < total) return refillOrAsk(userId, total - availableCents, availableCents, { refill, after: `untangle:${squadId}:${otherId}`, reason: `settling up with ${name}` });
  }
  for (const s of mine) {
    const r = await paySettlement(userId, s.id);
    if ("code" in r || "approveUrl" in r) return r;
  }
  return { ok: true as const, status: "paid", message: `Paid ${name} ${fmt(total)}. Untangled.` };
}

/** "Nudge" on a row: what they owe me goes to their kitten. If nothing's been untangled yet, this sets up the payment first. */
export async function nudgeRow(userId: string, squadId: string, otherId: string) {
  const d = await db();
  await inGroup(d, squadId, userId);
  const name = (await getUser(d, otherId))?.name ?? "They";
  const owedToMe = async () => (await openBetween(d, squadId, userId, otherId)).filter((s) => s.from_user === otherId);
  if (!(await owedToMe()).length && !(await openBetween(d, squadId, userId, otherId)).length) await untangleGroup(userId, squadId);
  if (!(await owedToMe()).length) return { ok: true as const, status: "nothing", message: `${name} doesn't owe you anything here.` };
  const r = await remindNow(userId, otherId, new Date(), { squadId });
  return { ok: true as const, status: r.status, message: r.text };
}
