/**
 * House Rules engine (PRD §B3, FR-RULE-3/5, FR-KIT-2/3, FR-MONTH-2). Deterministic: the LLM never
 * decides whether an action is allowed. Personal rules can only ever add "ask".
 */

export type RuleType = "R1" | "R2" | "R3" | "R4" | "R5" | "R6" | "R7" | "R8" | "personal";

export type Rule = {
  type: RuleType;
  squadId?: string | null;
  params: Record<string, unknown>;
  active?: boolean;
  text?: string;
};

export type MoneyAction = {
  kind: "paw_in" | "paw_up" | "cover" | "yarn" | "bowl" | "party" | "help";
  cents: number;
  squadId?: string | null;
  source: "jar" | "paypal" | "savings";
};

export type Decision = { mode: "auto" | "ask"; reasons: string[]; overBudgetByCents?: number };

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

export function freeHandCents(rules: Rule[], squadId?: string | null): number {
  const active = rules.filter((r) => r.active !== false && r.type === "R2");
  const global = active.find((r) => !r.squadId);
  const squad = squadId ? active.find((r) => r.squadId === squadId) : undefined;
  const g = num(global?.params.cents, 0);
  // Squads can only LOWER the free hand (PRD §B3 R2 "squads can lower it").
  return squad ? Math.min(g, num(squad.params.cents, g)) : g;
}

export function funBudgetCents(rules: Rule[]): number | null {
  const r = rules.find((x) => x.active !== false && x.type === "R1" && !x.squadId);
  return r ? num(r.params.cents, 0) : null;
}

/**
 * May the kitten do this money action on its own?
 * - personal rule that applies → ask (restrict-only guardrail)
 * - would exceed the fun budget → ask, with the overshoot (overspending guard)
 * - only Treat Jar money, within the free hand and the jar balance, can be auto
 */
export function decide(
  action: MoneyAction,
  ctx: {
    rules: Rule[];
    jarAvailableCents: number;
    monthSpentCents: number;
    monthCommittedCents: number;
    personalRuleApplies?: boolean;
  },
): Decision {
  const reasons: string[] = [];
  let mode: Decision["mode"] = "auto";
  let overBudgetByCents: number | undefined;

  if (ctx.personalRuleApplies) {
    mode = "ask";
    reasons.push("one of your own rules asks me to check with you");
  }

  const budget = funBudgetCents(ctx.rules);
  if (budget != null) {
    const after = ctx.monthSpentCents + ctx.monthCommittedCents + action.cents;
    if (after > budget) {
      mode = "ask";
      overBudgetByCents = after - budget;
      reasons.push("this would put you over your fun budget");
    }
  }

  if (action.source !== "jar") {
    mode = "ask";
    reasons.push("it isn't Treat Jar money, so it needs your approval");
  } else {
    const hand = freeHandCents(ctx.rules, action.squadId);
    if (action.cents > hand) {
      mode = "ask";
      reasons.push("it's more than your free hand");
    }
    if (action.cents > ctx.jarAvailableCents) {
      mode = "ask";
      reasons.push("your Treat Jar doesn't have enough");
    }
  }

  if (mode === "auto") reasons.push("within your free hand, from your Treat Jar");
  return { mode, reasons, overBudgetByCents };
}

/** R4: what friends' kittens may share about you. Money is never shareable (FR-RULE-8). */
export function shareable(rules: Rule[]): { availability: boolean; attendance: boolean; interests: boolean; money: false } {
  const r = rules.find((x) => x.active !== false && x.type === "R4" && !x.squadId);
  const p = (r?.params ?? {}) as Record<string, unknown>;
  return {
    availability: p.availability !== false,
    attendance: p.attendance !== false,
    interests: p.interests !== false,
    money: false,
  };
}

/** R5 "usually in": kitten may pre-fill yes (the owner still confirms). */
export function usuallyIn(rules: Rule[], squadId: string, cents: number | null): boolean {
  return rules.some(
    (r) => r.active !== false && r.type === "R5" && r.squadId === squadId && (cents == null || cents <= num(r.params.maxCents, Infinity)),
  );
}

/** Rules that can be stored: a custom rule must map to a known type or be a restrict-only personal rule. */
export function validateRule(rule: Rule): string | null {
  const known: RuleType[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "personal"];
  if (!known.includes(rule.type)) return "unknown rule type";
  if (rule.type === "R1" || rule.type === "R2" || rule.type === "R3") {
    const c = num(rule.params.cents, -1);
    if (!Number.isInteger(c) || c < 0) return "needs an amount in cents";
  }
  if (rule.type === "personal") {
    if (rule.params.effect !== "ask") return "personal rules can only make the kitten ask first";
  }
  return null;
}
