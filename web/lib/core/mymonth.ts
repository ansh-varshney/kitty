import { db } from "../db";
import { calendar, committedCents, jarBalances, monthSpending } from "./month";
import { listRules } from "./users";
import { myYarn } from "./yarn";
import { memberBalances } from "./party";
import { funBudgetCents } from "../referee/rules";

/**
 * My Month (PRD §B20, FR-MONTH-1/4, FR-CAL-1): the owner's private view of their month with friends, from Kitty's
 * own ledger. Money: budget meter, by squad, by kind, owed, saved, coming up. Calendar: plans in, decide-bys, busy.
 */
export async function myMonth(userId: string, now = new Date()) {
  const d = await db();
  const spending = await monthSpending(d, userId, now);
  const committed = await committedCents(d, userId);
  const budget = funBudgetCents(await listRules(d, userId));
  const yarn = await myYarn(userId);
  const squads = await d.query<{ id: string; name: string }>(`select s.id, s.name from squads s join memberships m on m.squad_id=s.id where m.user_id=$1 and m.left_at is null and s.kind='squad'`, [userId]);
  const saved = [];
  for (const s of squads) {
    const mine = (await memberBalances(d, s.id))[userId] ?? 0;
    if (mine) saved.push({ squadId: s.id, squad: s.name, cents: mine });
  }
  const jar = await jarBalances(d, userId);
  const cal = await calendar(d, userId);
  const in30 = now.getTime() + 30 * 86400_000;
  const holds = await d.query<{ title: string; cents: number; decide_by: string }>(
    `select pl.title, sum(p.cents)::int as cents, pl.decide_by from paws p join plans pl on pl.id=p.plan_id
     where p.user_id=$1 and p.status in ('pending','held') and pl.status in ('open','pouncing') group by pl.id, pl.title, pl.decide_by order by pl.decide_by`,
    [userId],
  );
  return {
    money: {
      meter: { spentCents: spending.totalCents, committedCents: committed, budgetCents: budget, leftCents: budget != null ? budget - spending.totalCents - committed : null },
      bySquad: spending.bySquad,
      byKind: spending.byKind,
      owed: { youOweCents: yarn.reduce((a, y) => a + y.youOweCents, 0), owedToYouCents: yarn.reduce((a, y) => a + y.owedToYouCents, 0) },
      saved: { partySavings: saved, treatJar: jar },
      comingUp: holds.filter((h) => Date.parse(h.decide_by) <= in30),
    },
    calendar: {
      plans: cal.plans.filter((p) => p.starts_at).map((p) => ({ id: p.id, title: p.title, startsAt: p.starts_at, endsAt: p.ends_at, decideBy: p.decide_by, status: p.status })),
      decideBy: cal.plans.filter((p) => p.status === "open").map((p) => ({ id: p.id, title: p.title, decideBy: p.decide_by })),
      busy: cal.busy,
    },
  };
}
