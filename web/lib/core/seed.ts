import { db } from "../db";
import { acct, move } from "./ledger";
import { logEvent } from "./events";
import { setBasicRules } from "./users";
import { testCardPayment } from "../paypal/holds";

/**
 * Demo friends for testing and (later) Demo World (PRD §D8 Phase 1, §B23). Their PayPal holds and
 * payments use the sandbox test card server-side; their emails are the uploaded sandbox accounts.
 */
export const DEMO_FRIENDS = [
  { key: "ava", name: "Ava", kitten: "Mochi", breed: "siamese", gender: "woman", birth: "2001-12-03", interests: ["travel", "food", "concerts"] },
  { key: "jordan", name: "Jordan", kitten: "Biscuit", breed: "persian", gender: "non-binary", birth: "2000-04-17", interests: ["games", "movies", "food"] },
  { key: "tyler", name: "Tyler", kitten: "Miso", breed: "bengal", gender: "man", birth: "1999-08-22", interests: ["sports", "nightlife", "travel"] },
  { key: "zoe", name: "Zoe", kitten: "Pickles", breed: "ragdoll", gender: "woman", birth: "2002-02-11", interests: ["concerts", "wellness", "food"] },
  { key: "marcus", name: "Marcus", kitten: "Tofu", breed: "tabby", gender: "man", birth: "2000-10-30", interests: ["outdoors", "sports", "games"] },
  { key: "judge", name: "Judge", kitten: "Noodle", breed: "shorthair", gender: "prefer not to say", birth: "1998-06-01", interests: ["food", "travel", "movies"] },
] as const;

export type DemoWorld = { users: Record<string, string>; squadId: string };

export async function seedDemoWorld(opts: { jarTopUpCents?: number; realTopUps?: boolean } = {}): Promise<DemoWorld> {
  const d = await db();
  const users: Record<string, string> = {};
  for (const f of DEMO_FRIENDS) {
    const [u] = await d.query<{ id: string }>(
      `insert into users (paypal_payer_id, name, paypal_email, email_verified, gender, birth_date, interests, onboarded, is_demo)
       values ($1,$2,$3,true,$4,$5,$6,true,true)
       on conflict (paypal_payer_id) do update set name=excluded.name returning id`,
      [`DEMO-${f.key}`, f.name, `${f.key}.kt26@personal.example.com`, f.gender, f.birth, f.interests],
    );
    users[f.key] = u.id;
    await d.query(
      `insert into kittens (user_id, name, breed, look) values ($1,$2,$3,$4) on conflict (user_id) do update set name=excluded.name, breed=excluded.breed`,
      [u.id, f.kitten, f.breed, JSON.stringify({ fur: "ginger", pattern: "tabby", accessory: "bell" })],
    );
    await setBasicRules(d, u.id, { funBudgetCents: 30000, freeHandCents: 2000, helpCents: 2500 });
  }
  let [squad] = await d.query<{ id: string }>(`select id from squads where invite_code='weekend-crew'`);
  if (!squad) {
    [squad] = await d.query<{ id: string }>(`insert into squads (name, kind, created_by, invite_code) values ('Weekend Crew','squad',$1,'weekend-crew') returning id`, [users.ava]);
    await logEvent(d, { squadId: squad.id, actor: "system", type: "squad.created", public: { name: "Weekend Crew" } });
  }
  for (const [k, id] of Object.entries(users)) {
    await d.query(`insert into memberships (squad_id, user_id, role) values ($1,$2,$3) on conflict do nothing`, [squad.id, id, k === "ava" ? "admin" : "member"]);
  }
  const topUp = opts.jarTopUpCents ?? 4000;
  for (const [k, id] of Object.entries(users)) {
    const [has] = await d.query<{ n: number }>(`select count(*)::int as n from ledger where account=$1 and kind='jar_topup'`, [acct.jar(id)]);
    if (has.n > 0 || topUp <= 0) continue;
    const pay = opts.realTopUps === false ? null : await testCardPayment({ cents: topUp, customId: `jar:demo-${k}` });
    await move(d, acct.world, acct.jar(id), topUp, { kind: "jar_topup", userId: id, paypalId: pay?.captureId ?? null, reason: "demo Treat Jar top-up" });
  }
  return { users, squadId: squad.id };
}

/** Seed savings for a member (Kitty Party creation is Phase 2; the savings source already works). */
export async function seedSavings(squadId: string, userId: string, cents: number) {
  const d = await db();
  await move(d, acct.world, acct.savings(squadId, userId), cents, { kind: "savings_contribution", userId, reason: "seeded savings (Kitty Party arrives in Phase 2)" });
}
