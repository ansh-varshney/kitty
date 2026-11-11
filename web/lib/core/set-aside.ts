import { db, type Queryable } from "../db";
import { acct, balance, move } from "./ledger";
import { getUser } from "./users";
import { testCardPayment } from "../paypal/holds";

/**
 * Agreeing and paying are one step (owner, 11 Nov 2026; FR-JAR-8). Whoever floats a whim, says yes to one, or asks to
 * tag along has their share set aside right then: from their own Kitty Party savings first when the plan uses them,
 * then their Treat Jar. If that isn't enough, they're asked to refill first, and the yes goes through once it lands.
 */

export type SetAside = { jarCents: number; savingsCents: number };
export type Part = { cents: number; savingsSquad: string | null };

/** How much more these shares need than this person has. Demo friends can't approve a refill, so the sandbox test card tops them up. */
export async function shortOfMany(userId: string, parts: Part[]): Promise<{ shortCents: number; jarCents: number }> {
  const d = await db();
  let fromJar = 0;
  const bySquad = new Map<string, number>();
  for (const p of parts) {
    if (p.cents <= 0) continue;
    if (!p.savingsSquad) {
      fromJar += p.cents;
      continue;
    }
    bySquad.set(p.savingsSquad, (bySquad.get(p.savingsSquad) ?? 0) + p.cents);
  }
  for (const [squad, cents] of bySquad) fromJar += Math.max(0, cents - (await balance(d, acct.savings(squad, userId))));
  const jarCents = await balance(d, acct.jar(userId));
  const shortCents = Math.max(0, fromJar - jarCents);
  if (shortCents > 0 && (await getUser(d, userId))?.is_demo) {
    const pay = await testCardPayment({ cents: shortCents, customId: `jar:${userId}` });
    await d.tx((q) => move(q, acct.world, acct.jar(userId), shortCents, { kind: "jar_topup", userId, paypalId: pay.captureId, reason: "Treat Jar top-up" }));
    return { shortCents: 0, jarCents: jarCents + shortCents };
  }
  return { shortCents, jarCents };
}

export const shortOf = (userId: string, cents: number, savingsSquad: string | null) => shortOfMany(userId, [{ cents, savingsSquad }]);

/** Move a share into the held accounts (savings first, if allowed). Callers check the money first and run this inside a transaction. */
export async function setAside(q: Queryable, userId: string, cents: number, savingsSquad: string | null, reason: string): Promise<SetAside> {
  const savingsCents = savingsSquad ? Math.min(await balance(q, acct.savings(savingsSquad, userId)), cents) : 0;
  const jarCents = cents - savingsCents;
  if (savingsCents > 0) await move(q, acct.savings(savingsSquad!, userId), acct.savingsHeld(savingsSquad!, userId), savingsCents, { kind: "savings_reserve", userId, reason });
  if (jarCents > 0) await move(q, acct.jar(userId), acct.jarHeld(userId), jarCents, { kind: "jar_reserve", userId, reason });
  return { jarCents, savingsCents };
}

/** Put a set-aside share back where it came from. */
export async function giveBack(q: Queryable, userId: string, held: SetAside, savingsSquad: string | null, reason: string) {
  if (held.savingsCents > 0 && savingsSquad) await move(q, acct.savingsHeld(savingsSquad, userId), acct.savings(savingsSquad, userId), held.savingsCents, { kind: "savings_release", userId, reason });
  if (held.jarCents > 0) await move(q, acct.jarHeld(userId), acct.jar(userId), held.jarCents, { kind: "jar_release", userId, reason });
}
