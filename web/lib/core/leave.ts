import { db } from "../db";
import { logEvent } from "./events";
import { acct, balance } from "./ledger";
import { getUser, isMember } from "./users";
import { yarnPosition } from "./yarn";
import { releaseMember } from "./pounce";
import { stopSaving } from "./party";
import { leaveBowl } from "./bowl";
import { withLock } from "./locks";

/**
 * Leave a squad (edge-case pass, 8 Nov; PRD §B13 "take your savings back, e.g. when leaving the squad").
 * Nobody may leave with money still tangled up, so leaving is blocked, with the reason, while you:
 *   - owe or are owed in its Yarn (or have a card waiting for answers),
 *   - have Kitty Party savings there (withdraw them first),
 *   - host or book a plan there that isn't finished,
 *   - hold the account of one of its Bowls (close it first).
 * Otherwise: your holds on its open plans are released, your monthly saving stops, you leave its Bowls (the others'
 * shares are recomputed), your rules for it switch off, and the squad sees "X left". Your history stays in your Diary.
 */
export async function leaveSquad(userId: string, squadId: string) {
  return withLock(`leave:${squadId}:${userId}`, async () => {
    const d = await db();
    if (!(await isMember(d, squadId, userId))) throw new Error("You're not in that squad.");
    const [squad] = await d.query<{ name: string; kind: string }>(`select name, kind from squads where id=$1`, [squadId]);

    const y = await yarnPosition(d, squadId, userId);
    if (y.balanceCents < 0 || y.openPayments) throw new Error(`You still owe money in ${squad.name}'s Yarn. Untangle and pay first, then you can leave.`);
    if (y.balanceCents > 0) throw new Error(`Friends in ${squad.name} still owe you in Yarn. Untangle first (or remove those cards), then you can leave.`);
    if (y.pendingCards) throw new Error(`There's an "I paid" card in ${squad.name} still waiting for answers. Confirm or remove it first.`);

    const savings = (await balance(d, acct.savings(squadId, userId))) + (await balance(d, acct.savingsHeld(squadId, userId)));
    if (savings > 0) throw new Error(`You have $${(savings / 100).toFixed(2)} saved in ${squad.name}'s Kitty Party. Withdraw it first.`);

    const hosting = await d.query<{ title: string }>(
      `select title from plans where squad_id=$1 and (host_id=$2 or booker_id=$2) and status in ('open','pouncing','pounced','on_ice')`,
      [squadId, userId],
    );
    if (hosting.length) throw new Error(`You're hosting or booking "${hosting[0].title}". Cancel it, finish it, or hand it over first.`);

    const owns = await d.query<{ service: string }>(`select service from bowls where squad_id=$1 and owner_id=$2 and status='active'`, [squadId, userId]);
    if (owns.length) throw new Error(`You hold the ${owns[0].service} account in the Bowl. Close it first.`);

    // Nothing tangled: tidy up and go.
    const plans = await d.query<{ id: string }>(
      `select p.id from plans p join plan_members m on m.plan_id=p.id where p.squad_id=$1 and m.user_id=$2 and p.status='open' and m.status <> 'out'`,
      [squadId, userId],
    );
    for (const p of plans) await releaseMember(p.id, userId, "you left the squad", { text: "You left the squad, so everything I held for this plan is released." });
    const party = await d.query(`select 1 from party_members m join parties p on p.id=m.party_id where p.squad_id=$1 and m.user_id=$2 and m.status <> 'stopped'`, [squadId, userId]);
    if (party.length) await stopSaving(userId, squadId);
    const bowls = await d.query<{ bowl_id: string }>(
      `select m.bowl_id from bowl_members m join bowls b on b.id=m.bowl_id where b.squad_id=$1 and m.user_id=$2 and m.status <> 'left' and b.status='active'`,
      [squadId, userId],
    );
    for (const b of bowls) await leaveBowl(userId, b.bowl_id);

    const me = await getUser(d, userId);
    await d.tx(async (q) => {
      await q.query(`update rules set active=false where user_id=$1 and squad_id=$2`, [userId, squadId]);
      await q.query(`update memberships set left_at=now() where squad_id=$1 and user_id=$2`, [squadId, userId]);
      if (squad.kind === "gift") await q.query(`update gift_members set status='skipped' where user_id=$1 and group_id in (select id from gift_groups where squad_id=$2)`, [userId, squadId]);
      await logEvent(q, { userId, squadId, actor: "user", actorId: userId, type: "squad.left", payload: { text: `You left ${squad.name}.` } });
      await logEvent(q, { squadId, actor: "system", type: "squad.left", public: { text: `${me?.name ?? "Someone"} left the squad.`, userId } });
    });
    return { ok: true, plansReleased: plans.length, bowlsLeft: bowls.length };
  });
}
