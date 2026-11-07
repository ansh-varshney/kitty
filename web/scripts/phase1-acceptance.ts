/**
 * Phase 1 acceptance tests (PRD §D7 AT-1..12, 14..16, 19, 21..23), end to end against the REAL PayPal
 * sandbox and Gemini, on a fresh in-memory database. Run from web/:  npm run accept:phase1
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";

loadEnv();
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;

type Result = { id: string; name: string; ok: boolean; detail: string; ms: number; blocked?: boolean };
const results: Result[] = [];
let payoutsFunded = true; // set by a $5 probe at the start; see scripts/check-payout.ts
const day = (iso: string) => new Date(iso).toISOString();

async function at(id: string, name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, detail, ms: Date.now() - t0 });
    console.log(`PASS ${id.padEnd(6)} ${name}  (${Date.now() - t0} ms)  ${detail}`);
  } catch (e) {
    const msg = (e as Error).message;
    // With the platform's payout balance empty, money-out steps can't finish; say so instead of a bare FAIL.
    const blocked = !payoutsFunded && /payout|INSUFFICIENT_FUNDS|pot|pending|hasn't arrived/i.test(msg);
    results.push({ id, name, ok: false, detail: msg, ms: Date.now() - t0, blocked });
    console.log(`${blocked ? "BLOCKED (payouts unfunded)" : "FAIL"} ${id.padEnd(6)} ${name}  ${msg}`);
  }
}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { db } = await import("../lib/db");
  const users = await import("../lib/core/users");
  const whims = await import("../lib/core/whims");
  const plans = await import("../lib/core/plans");
  const pounce = await import("../lib/core/pounce");
  const receipts = await import("../lib/core/receipts");
  const { runTick } = await import("../lib/core/tick");
  const { seedDemoWorld, seedSavings } = await import("../lib/core/seed");
  const { acct, balance, ledgerSumsToZero } = await import("../lib/core/ledger");
  const { squadFeed } = await import("../lib/core/events");
  const { kittenChat, askFriendKitten } = await import("../lib/kitten/chat");
  const { decide } = await import("../lib/referee/rules");

  const d = await db();
  try {
    const { sendPayout } = await import("../lib/paypal/payouts");
    await sendPayout([{ email: "ava.kt26@personal.example.com", cents: 500, note: "Kitty acceptance probe", itemId: `probe-${Date.now()}` }], "Kitty acceptance probe");
  } catch (e) {
    payoutsFunded = false;
    console.log(`WARNING: the platform can't send payouts right now (${String((e as Error).message).slice(0, 80)}). Checks that need money out will show as BLOCKED.`);
  }
  console.log(`DB: ${d.kind} (in memory). Seeding demo friends (6 real sandbox Treat Jar top-ups)…`);
  const world = await seedDemoWorld({ jarTopUpCents: 4000 });
  const U = world.users;
  const crew = world.squadId;

  /** Float a whim, have chosen friends say yes, return the plan id. */
  async function makePlan(host: string, opts: { squadId?: string; friends?: string[]; what: string; startsAt: string; endsAt?: string; priceCents: number; need: number; yes: string[]; rule?: "everyone" | "at_least" | "host" }) {
    const w = await whims.createWhim(U[host], { squadId: opts.squadId, friendIds: opts.friends?.map((f) => U[f]), what: opts.what, startsAt: opts.startsAt, endsAt: opts.endsAt, priceCents: opts.priceCents, needAtLeast: opts.need });
    let planId = "";
    for (const f of opts.yes) {
      const pend = (await whims.pendingAnswers(U[f])).filter((a) => a.whim_id === w.whimId);
      const r = await whims.confirmAnswers(U[f], pend.map((a) => ({ answerId: a.id, answer: "yes" as const })));
      if (r.plansCreated[0]) planId = r.plansCreated[0];
    }
    expect(planId, `plan for ${opts.what} was not created`);
    await plans.editPlan(U[host], planId, { priceCents: opts.priceCents, pounceRule: opts.rule ?? "everyone", needAtLeast: opts.need });
    return { planId, whimId: w.whimId, squadId: w.squadId };
  }

  await at("AT-1", "Sign-up: 5 pages of data, kitten, rules, squad", async () => {
    const u = await users.upsertPayPalUser(d, { payerId: "TEST-NEWBIE", name: "Riley", email: "riley.kt26@personal.example.com", emailVerified: true });
    let rejected = false;
    try {
      await users.completeOnboarding(d, u.id, { name: "Riley", gender: "woman", birthDate: "2001-01-01", shareBirthday: true, interests: ["food"], kitten: { name: "Bean", breed: "tabby", look: { fur: "grey", pattern: "plain", accessory: "scarf" } }, rules: { funBudgetCents: 20000, freeHandCents: 1500, helpCents: 2000 } });
    } catch {
      rejected = true;
    }
    expect(rejected, "onboarding with only 1 interest should be rejected (min 3)");
    await users.completeOnboarding(d, u.id, { name: "Riley", gender: "woman", birthDate: "2001-01-01", shareBirthday: true, interests: ["food", "movies", "travel"], kitten: { name: "Bean", breed: "tabby", look: { fur: "grey", pattern: "plain", accessory: "scarf" } }, rules: { funBudgetCents: 20000, freeHandCents: 1500, helpCents: 2000 } });
    await users.joinSquad(d, u.id, "weekend-crew");
    const me = await users.getUser(d, u.id);
    const rules = await users.listRules(d, u.id);
    expect(me?.onboarded && me.email_verified, "user not onboarded/verified");
    expect(rules.length === 4, `expected 4 basic rules, got ${rules.length}`);
    expect(await users.isMember(d, crew, u.id), "not in squad");
    await d.query(`update memberships set left_at=now() where user_id=$1`, [u.id]); // keep the demo squad at 6 for later tests
    return "onboarded, kitten Bean, 4 rules, joined Weekend Crew; 1-interest sign-up rejected";
  });

  let screenshotWhim = "";
  await at("AT-2", "Whim from a chat screenshot (AI vision)", async () => {
    // One read, as in the app (two back-to-back reads of the same image spend the vision model's per-minute budget).
    const img = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "chat-cabin.png")).toString("base64");
    const t0 = Date.now();
    const w = await whims.createWhim(U.ava, { squadId: crew, imageBase64: img, mimeType: "image/png" });
    const parsed = w.parsed!;
    screenshotWhim = w.whimId;
    expect(/cabin|tahoe/i.test(parsed.what + " " + (parsed.place ?? "")), `what/place not understood: ${parsed.what} / ${parsed.place}`);
    expect(parsed.priceCents === 70000 || parsed.upToCents === 15000, `money not read: price ${parsed.priceCents}, up to ${parsed.upToCents}`);
    return `what="${parsed.what}", place=${parsed.place}, price=${parsed.priceCents}, upTo=${parsed.upToCents}, when=${parsed.whenText ?? parsed.startsAt} (${Date.now() - t0} ms incl. 5 reason lines)`;
  });

  await at("AT-3", "Prepared answers with a reason; one-tap batch confirm", async () => {
    // Stand alone if the screenshot check couldn't make its whim (e.g. Gemini down): use a typed whim instead.
    if (!screenshotWhim) screenshotWhim = (await whims.createWhim(U.ava, { squadId: crew, text: "cabin weekend dec 12-14, 700 total" })).whimId;
    const rows = await d.query<{ user_id: string; prepared: string; prepared_reason: string; confirmed: string | null }>(`select user_id, prepared, prepared_reason, confirmed from answers where whim_id=$1`, [screenshotWhim]);
    expect(rows.length === 5, `expected 5 prepared answers, got ${rows.length}`);
    expect(rows.every((r) => r.prepared && r.prepared_reason?.length > 5), "missing prepared answer or reason");
    expect(rows.every((r) => r.confirmed === null), "AT-16: a kitten confirmed on its own");
    const pend = (await whims.pendingAnswers(U.jordan)).filter((a) => a.whim_id === screenshotWhim);
    await whims.confirmAnswers(U.jordan, pend.map((a) => ({ answerId: a.id })));
    const [j] = await d.query<{ confirmed: string }>(`select confirmed from answers where whim_id=$1 and user_id=$2`, [screenshotWhim, U.jordan]);
    return `5 answers prepared (e.g. "${rows[0].prepared_reason}"); Jordan confirmed "${j.confirmed}" in one tap`;
  });

  await at("AT-4", "Whim fades; only the floater is told", async () => {
    const w = await whims.createWhim(U.tyler, { squadId: crew, what: "Escape room", startsAt: day("2026-12-05T18:00:00Z"), endsAt: day("2026-12-05T20:00:00Z"), needAtLeast: 6 });
    const pend = (await whims.pendingAnswers(U.zoe)).filter((a) => a.whim_id === w.whimId);
    await whims.confirmAnswers(U.zoe, pend.map((a) => ({ answerId: a.id, answer: "yes" as const })));
    await runTick(new Date(Date.now() + 73 * 3600_000));
    const [row] = await d.query<{ status: string }>(`select status from whims where id=$1`, [w.whimId]);
    const told = await d.query<{ user_id: string }>(`select user_id from events where type='whim.faded' and object_id=$1`, [w.whimId]);
    expect(row.status === "faded", `status ${row.status}`);
    expect(told.length === 1 && told[0].user_id === U.tyler, "someone other than the floater was told");
    return "faded after expiry; 1 private note to Tyler, nobody else";
  });

  // Plans for later tests are created now so the deadline tick handles them together.
  const bowling = await makePlan("ava", { friends: ["jordan", "tyler", "zoe"], what: "Bowling night", startsAt: day("2026-12-04T18:00:00Z"), endsAt: day("2026-12-04T22:00:00Z"), priceCents: 12000, need: 4, yes: ["jordan", "tyler", "zoe"] });

  await at("AT-5", "Full Pounce: 4 of 4 in, exact shares, booker paid", async () => {
    for (const k of ["ava", "jordan", "tyler", "zoe"]) {
      const r = await pounce.pawIn(U[k], bowling.planId, { limitCents: 3500 });
      expect(r.ok, `${k} paw-in failed: ${JSON.stringify(r)}`);
    }
    const [p] = await d.query<{ status: string }>(`select status from plans where id=$1`, [bowling.planId]);
    const [pc] = await d.query<{ total_cents: number; payout_batch_id: string; shares: Record<string, number> }>(`select total_cents, payout_batch_id, shares from pounces where plan_id=$1`, [bowling.planId]);
    expect(p.status === "pounced", `status ${p.status}`);
    expect(pc.total_cents === 12000 && Object.values(pc.shares).every((s) => s === 3000), `shares ${JSON.stringify(pc.shares)}`);
    expect(pc.payout_batch_id, "friends were charged but the booker's payout didn't go out (platform payout balance? run scripts/check-payout.ts)");
    return `4 × $30.00 captured from PayPal holds; $120.00 Payout ${pc.payout_batch_id} to Ava`;
  });

  const cabin = await makePlan("ava", { squadId: crew, what: "Cabin trip", startsAt: day("2026-12-12T16:00:00Z"), endsAt: day("2026-12-14T16:00:00Z"), priceCents: 70000, need: 4, yes: ["jordan", "tyler", "zoe", "marcus"], rule: "host" });
  await seedSavings(crew, U.jordan, 6000);

  await at("AT-10", "Savings first: $60 savings + $80 hold for a $140 limit", async () => {
    const r = await pounce.pawIn(U.jordan, cabin.planId, { limitCents: 14000 });
    expect(r.ok && r.savingsCents === 6000 && r.paypalCents === 8000, JSON.stringify(r));
    return `savings ${r.ok && r.savingsCents}, PayPal hold ${r.ok && r.paypalCents}`;
  });

  await at("AT-7", "Paw-up: only the short member is asked; yes funds it from the Treat Jar", async () => {
    for (const [k, c] of [["ava", 15000], ["tyler", 16000], ["zoe", 14000], ["marcus", 13000]] as const) {
      const r = await pounce.pawIn(U[k], cabin.planId, { limitCents: c, confirmOverBudget: true });
      expect(r.ok, `${k}: ${JSON.stringify(r)}`);
    }
    const first = await pounce.tryPounce(cabin.planId, { hostTapped: true });
    expect((first as { status: string }).status === "waiting_paw_up", `expected a paw-up round, got ${JSON.stringify(first)}`);
    const asked = await d.query<{ user_id: string; pawup_need_cents: number }>(`select user_id, pawup_need_cents from plan_members where plan_id=$1 and pawup_need_cents is not null`, [cabin.planId]);
    expect(asked.length === 1 && asked[0].user_id === U.marcus && asked[0].pawup_need_cents === 1000, `asked: ${JSON.stringify(asked)}`);
    await pounce.answerPawUp(U.marcus, cabin.planId, true);
    const done = await pounce.tryPounce(cabin.planId, { hostTapped: true });
    expect((done as { status: string }).status === "pounced", `after paw-up: ${JSON.stringify(done)}`);
    const [jar] = await d.query<{ source: string }>(`select source from paws where plan_id=$1 and user_id=$2 and kind='paw_up'`, [cabin.planId, U.marcus]);
    return `Marcus (only) asked for $10.00; paid from ${jar.source}; Pounce at $140.00 × 5 = $700.00`;
  });

  await at("AT-7b", "Paw-up decline: the member is removed, shares recomputed", async () => {
    const p = await makePlan("zoe", { friends: ["marcus", "judge"], what: "Spa day", startsAt: day("2026-12-19T17:00:00Z"), endsAt: day("2026-12-19T21:00:00Z"), priceCents: 30000, need: 2, yes: ["marcus", "judge"], rule: "host" });
    for (const [k, c] of [["zoe", 15000], ["marcus", 15000], ["judge", 9000]] as const) {
      const r = await pounce.pawIn(U[k], p.planId, { limitCents: c, confirmOverBudget: true });
      expect(r.ok, `${k}: ${JSON.stringify(r)}`);
    }
    const first = await pounce.tryPounce(p.planId, { hostTapped: true });
    expect((first as { status: string }).status === "waiting_paw_up", `expected a paw-up round, got ${JSON.stringify(first)}`);
    await pounce.answerPawUp(U.judge, p.planId, false);
    const res = await pounce.tryPounce(p.planId, { hostTapped: true });
    const [pc] = await d.query<{ group_ids: string[]; shares: Record<string, number> }>(`select group_ids, shares from pounces where plan_id=$1`, [p.planId]);
    expect((res as { status: string }).status === "pounced" && pc.group_ids.length === 2, JSON.stringify(res));
    return `Judge declined → released; Zoe + Marcus pay ${Object.values(pc.shares).map((s) => s / 100).join(" + ")}`;
  });

  await at("AT-12", "Receipt under budget: $20 leftover back by share, to each source", async () => {
    const r = await receipts.submitReceipt(U.ava, cabin.planId, { cents: 68000 });
    const res = await receipts.confirmReceipt(U.ava, r.receiptId, 68000);
    expect(res.kind === "leftover" && res.leftoverCents === 2000, JSON.stringify(res));
    const back = (res as { refunds: { userId: string; source: string; cents: number }[] }).refunds;
    const total = back.reduce((a, b) => a + b.cents, 0);
    expect(total === 1600 && (res as { bookerReturnedCents: number }).bookerReturnedCents === 1600, `others got ${total}`);
    const jordanParts = back.filter((b) => b.userId === U.jordan);
    expect(jordanParts.some((b) => b.source === "savings") && jordanParts.some((b) => b.source === "paypal"), "Jordan's $4 should split savings/PayPal");
    return `$4.00 each; Ava returned $16.00; Jordan's $4 → ${jordanParts.map((b) => `${b.source} ${b.cents}`).join(" + ")}`;
  });

  await at("AT-9", "Tag along: newcomer pays the new share; refunds add up exactly", async () => {
    const r = await pounce.tagAlong(U.judge, cabin.planId, { limitCents: 15000 });
    expect(r.ok, JSON.stringify(r));
    const sum = Object.values((r as { refunds: Record<string, number> }).refunds).reduce((a, b) => a + b, 0);
    expect(sum === (r as { newcomerPays: number }).newcomerPays, `refunds ${sum} vs paid ${(r as { newcomerPays: number }).newcomerPays}`);
    return `Judge paid ${(r as { newcomerPays: number }).newcomerPays}; refunds ${JSON.stringify(Object.values((r as { refunds: Record<string, number> }).refunds))}`;
  });

  const movie = await makePlan("tyler", { squadId: crew, what: "Movie night", startsAt: day("2026-12-22T02:00:00Z"), endsAt: day("2026-12-22T05:00:00Z"), priceCents: 6000, need: 4, yes: ["ava", "zoe", "marcus"], rule: "at_least" });
  const pickle = await makePlan("ava", { squadId: crew, what: "Pickleball", startsAt: day("2026-12-20T17:00:00Z"), endsAt: day("2026-12-20T19:00:00Z"), priceCents: 8000, need: 3, yes: ["jordan", "tyler"], rule: "at_least" });

  await at("AT-6", "Partial Pounce: 6 invited, 4 in, at least 3", async () => {
    for (const k of ["ava", "jordan", "tyler", "zoe"]) {
      const r = await pounce.pawIn(U[k], pickle.planId, { limitCents: 2500, confirmOverBudget: true });
      expect(r.ok, `${k}: ${JSON.stringify(r)}`);
    }
    await pounce.pawIn(U.tyler, movie.planId, { limitCents: 2000, confirmOverBudget: true });
    await pounce.pawIn(U.ava, movie.planId, { limitCents: 2000, confirmOverBudget: true });
    const tick = await runTick(new Date(Date.now() + 49 * 3600_000));
    const [pc] = await d.query<{ group_ids: string[]; shares: Record<string, number> }>(`select group_ids, shares from pounces where plan_id=$1`, [pickle.planId]);
    expect(pc && pc.group_ids.length === 4, `pickleball not pounced: ${JSON.stringify(tick.deadlines)}`);
    const others = await d.query(`select 1 from paws where plan_id=$1 and user_id = any($2)`, [pickle.planId, [U.marcus, U.judge]]);
    expect(others.length === 0, "Marcus/Judge should never be charged");
    const sources = await d.query<{ source: string }>(`select distinct source from paws where plan_id=$1`, [pickle.planId]);
    return `4 × $20.00 at the deadline (sources: ${sources.map((s) => s.source).join(", ")}); Marcus and Judge never charged`;
  });

  await at("AT-11", "Deadline miss: rule unmet → everything released", async () => {
    const [p] = await d.query<{ status: string }>(`select status from plans where id=$1`, [movie.planId]);
    const paws = await d.query<{ status: string }>(`select status from paws where plan_id=$1`, [movie.planId]);
    expect(p.status === "on_ice", `status ${p.status}`);
    expect(paws.length > 0 && paws.every((x) => x.status === "voided"), `paws ${JSON.stringify(paws)}`);
    return `on ice; ${paws.length} holds released`;
  });

  await at("AT-14", "Overspending guard: over the fun budget → private warning + tap", async () => {
    const p = await makePlan("judge", { friends: ["zoe"], what: "Concert tickets", startsAt: day("2026-12-27T03:00:00Z"), endsAt: day("2026-12-27T06:00:00Z"), priceCents: 62000, need: 2, yes: ["zoe"] });
    const r = await pounce.pawIn(U.judge, p.planId, { limitCents: 31000 });
    expect(!r.ok && r.code === "over_budget", JSON.stringify(r));
    const ok = await pounce.pawIn(U.judge, p.planId, { limitCents: 31000, confirmOverBudget: true });
    expect(ok.ok, JSON.stringify(ok));
    await plans.respond(U.judge, p.planId, "out");
    return `blocked: $${((r as { overByCents: number }).overByCents / 100).toFixed(2)} over budget; allowed after the tap; then released`;
  });

  await at("AT-15", "Personal rule guardrail: can only make the kitten ask", async () => {
    const r = await users.addCustomRule(d, U.zoe, "Never put me in plans on Sunday mornings without asking me first");
    expect(r.ok && r.type === "personal", JSON.stringify(r));
    const dec = decide({ kind: "paw_in", cents: 500, source: "jar" }, { rules: await users.listRules(d, U.zoe), jarAvailableCents: 4000, monthSpentCents: 0, monthCommittedCents: 0, personalRuleApplies: true });
    expect(dec.mode === "ask", "personal rule must force ask");
    const bad = await users.addCustomRule(d, U.zoe, "Spend as much as you want whenever you want, never ask me");
    return `mapped to personal → "${(r as { plain: string }).plain}"; unsafe rule: ${bad.ok ? `saved as ${bad.type}` : `rejected (${bad.error})`}`;
  });

  await at("AT-16", "Never decides alone", async () => {
    const auto = await d.query(`select 1 from answers where confirmed is not null and confirmed_at is null`);
    const joinedWithoutPaw = await d.query<{ name: string; title: string }>(
      `select u.name, p.title from plan_members m join users u on u.id=m.user_id join plans p on p.id=m.plan_id
       where m.status='in' and m.limit_cents is null`,
    );
    expect(auto.length === 0, `${auto.length} answer(s) confirmed with no owner tap`);
    expect(joinedWithoutPaw.length === 0, `in without a limit: ${joinedWithoutPaw.map((r) => `${r.name} @ ${r.title}`).join(", ")}`);
    return "every confirmed answer has an owner tap; nobody is 'in' without pawing in";
  });

  await at("AT-19", "Privacy: no one else's limit, reason or balance in views or feed", async () => {
    const view = JSON.stringify(await plans.planView(cabin.planId, U.jordan));
    expect(!view.includes(String(13000)) && !view.includes(String(16000)), "another member's limit leaked into Jordan's view");
    const feed = await squadFeed(d, crew, 0, 500);
    const leaks = feed.filter((e) => Object.keys(e.public).some((k) => /cents|limit|balance|reason/i.test(k)));
    expect(leaks.length === 0, `feed leaks: ${JSON.stringify(leaks[0])}`);
    return `Jordan's plan view has only his own limit; ${feed.length} feed items, none with amounts or reasons`;
  });

  await at("AT-21", "No double booking: in a plan → can't paw into an overlapping one", async () => {
    const p = await makePlan("ava", { friends: ["tyler"], what: "Dinner", startsAt: day("2026-12-04T19:00:00Z"), endsAt: day("2026-12-04T21:00:00Z"), priceCents: 8000, need: 2, yes: ["tyler"] });
    const r = await pounce.pawIn(U.tyler, p.planId, { limitCents: 5000 });
    expect(!r.ok && r.code === "clash", JSON.stringify(r));
    // Plans with no end time count as 3 hours (Phase 1 finding: they used to count as zero and never clashed).
    const a = await makePlan("zoe", { friends: ["marcus"], what: "Trivia", startsAt: day("2027-01-08T03:00:00Z"), priceCents: 2000, need: 2, yes: ["marcus"] });
    expect((await pounce.pawIn(U.marcus, a.planId, { limitCents: 1000, confirmOverBudget: true })).ok, "marcus trivia");
    const b = await makePlan("zoe", { friends: ["marcus"], what: "Late dinner", startsAt: day("2027-01-08T04:30:00Z"), priceCents: 2000, need: 2, yes: ["marcus"] });
    const r2 = await pounce.pawIn(U.marcus, b.planId, { limitCents: 1000, confirmOverBudget: true });
    expect(!r2.ok && r2.code === "clash", `no-end-time plans should clash: ${JSON.stringify(r2)}`);
    await plans.respond(U.marcus, a.planId, "out");
    return `blocked: Tyler is already in "${(r as { withPlan: string }).withPlan}"; a plan with no end time also blocks (Marcus)`;
  });

  await at("AT-22", "Mini-squad: made for chosen friends, archived after settling, can be kept", async () => {
    const [s] = await d.query<{ kind: string }>(`select kind from squads where id=$1`, [bowling.squadId]);
    expect(s.kind === "mini", `kind ${s.kind}`);
    const r = await receipts.submitReceipt(U.ava, bowling.planId, { cents: 12000 });
    await receipts.confirmReceipt(U.ava, r.receiptId, 12000);
    const [a] = await d.query<{ archived_at: string | null }>(`select archived_at from squads where id=$1`, [bowling.squadId]);
    expect(a.archived_at, "not archived after settling");
    await users.keepAsSquad(d, U.ava, bowling.squadId, "Bowling Buddies");
    const [k] = await d.query<{ kind: string; archived_at: string | null }>(`select kind, archived_at from squads where id=$1`, [bowling.squadId]);
    expect(k.kind === "squad" && !k.archived_at, "keep as squad failed");
    return "mini-squad → settled → archived → kept as 'Bowling Buddies'";
  });

  await at("AT-23", "Suggestions loop guard: ≤ 2 rounds, no repeats, best option found", async () => {
    const p = await makePlan("judge", { squadId: crew, what: "Game night", startsAt: day("2026-12-13T01:00:00Z"), endsAt: day("2026-12-13T04:00:00Z"), priceCents: 3000, need: 2, yes: ["tyler", "zoe", "marcus"] });
    const res = await plans.negotiate(p.planId);
    const sugg = await d.query<{ candidate: { startsAt: string }; round: number }>(`select candidate, round from suggestions where plan_id=$1 and from_user is not null`, [p.planId]);
    const keys = sugg.map((s) => s.candidate.startsAt);
    expect(res.rounds <= 2 && sugg.every((s) => s.round <= 2), `rounds ${res.rounds}`);
    expect(new Set(keys).size === keys.length, "a suggestion repeated");
    return `rounds ${res.rounds}; ${sugg.length} suggestion(s); best fits ${res.fits}/${res.of}${res.changed ? ` on ${res.chosenStartsAt?.slice(0, 10)}` : ""}`;
  });

  await at("POUNCE-F", "A capture fails: everyone's money comes back, they paw in again, then it works", async () => {
    const { voidHold } = await import("../lib/paypal/holds");
    const p = await makePlan("ava", { friends: ["tyler"], what: "Karaoke", startsAt: day("2026-12-29T03:00:00Z"), endsAt: day("2026-12-29T05:00:00Z"), priceCents: 5000, need: 2, yes: ["tyler"], rule: "host" });
    for (const k of ["ava", "tyler"]) expect((await pounce.pawIn(U[k], p.planId, { limitCents: 2500, confirmOverBudget: true })).ok, `${k} paw-in`);
    const [t] = await d.query<{ authorization_id: string }>(`select authorization_id from paws where plan_id=$1 and user_id=$2 and status='held' and source='paypal'`, [p.planId, U.tyler]);
    expect(t?.authorization_id, "Tyler should have a PayPal hold");
    await voidHold(t.authorization_id); // the hold dies outside the app (expired, cancelled at PayPal…)
    const res = await pounce.tryPounce(p.planId, { hostTapped: true });
    expect((res as { status: string }).status === "capture_failed", JSON.stringify(res));
    const [pl] = await d.query<{ status: string }>(`select status from plans where id=$1`, [p.planId]);
    const mem = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1 and user_id = any($2)`, [p.planId, [U.ava, U.tyler]]);
    const live = await d.query(`select 1 from paws where plan_id=$1 and status in ('held','pending')`, [p.planId]);
    expect(pl.status === "open" && mem.every((m) => m.status === "thinking") && live.length === 0, `plan ${pl.status}, members ${JSON.stringify(mem)}, live paws ${live.length}`);
    expect((await balance(d, acct.plan(p.planId))) === 0, "pot should be empty after the failed Pounce");
    for (const k of ["ava", "tyler"]) expect((await pounce.pawIn(U[k], p.planId, { limitCents: 2500, confirmOverBudget: true })).ok, `${k} re-paw`);
    const again = await pounce.tryPounce(p.planId, { hostTapped: true });
    expect((again as { status: string }).status === "pounced", JSON.stringify(again));
    return "capture failed → Ava refunded, both released, plan reopened → both pawed in again → Pounce $25 + $25";
  });

  await at("PAYOUT-R", "Booker payout fails after friends paid: money waits in the pot, the timer pays it later", async () => {
    const p = await makePlan("zoe", { friends: ["jordan"], what: "Mini golf", startsAt: day("2026-12-30T20:00:00Z"), endsAt: day("2026-12-30T22:00:00Z"), priceCents: 4000, need: 2, yes: ["jordan"], rule: "host" });
    for (const k of ["zoe", "jordan"]) expect((await pounce.pawIn(U[k], p.planId, { limitCents: 2000, confirmOverBudget: true })).ok, `${k} paw-in`);
    const [z] = await d.query<{ paypal_email: string }>(`select paypal_email from users where id=$1`, [U.zoe]);
    await d.query(`update users set paypal_email='not-an-email' where id=$1`, [U.zoe]); // PayPal will refuse this payout
    let res: unknown;
    try {
      res = await pounce.tryPounce(p.planId, { hostTapped: true });
    } finally {
      await d.query(`update users set paypal_email=$2 where id=$1`, [U.zoe, z.paypal_email]);
    }
    expect((res as { status: string; payoutPending: boolean }).status === "pounced" && (res as { payoutPending: boolean }).payoutPending, JSON.stringify(res));
    const waiting = await balance(d, acct.plan(p.planId));
    const [pc1] = await d.query<{ status: string }>(`select status from pounces where plan_id=$1`, [p.planId]);
    expect(waiting === 4000 && pc1.status === "payout_pending", `pot ${waiting}, pounce ${pc1.status}`);
    const told = await d.query(`select 1 from events where user_id=$1 and type='payout.delayed' and object_id=$2`, [U.zoe, p.planId]);
    expect(told.length === 1, "the booker should be told not to book yet");
    const tick = await runTick();
    const [pc2] = await d.query<{ status: string; payout_batch_id: string }>(`select status, payout_batch_id from pounces where plan_id=$1`, [p.planId]);
    expect(tick.payoutsRetried >= 1 && pc2.status === "done" && (await balance(d, acct.plan(p.planId))) === 0, `retried ${tick.payoutsRetried}, pounce ${pc2.status}`);
    return `payout refused → $40.00 kept in the pot, Zoe told to wait → timer retried → paid (batch ${pc2.payout_batch_id})`;
  });

  await at("SHARE", "Everyone sees their share (need at least, or who's in); a weighted split is what's charged", async () => {
    const p = await makePlan("ava", { squadId: crew, what: "Brunch", startsAt: day("2027-01-10T18:00:00Z"), endsAt: day("2027-01-10T20:00:00Z"), priceCents: 6000, need: 3, yes: ["jordan", "tyler", "zoe", "marcus"], rule: "host" });
    const v1 = await plans.planView(p.planId, U.tyler);
    expect(v1.share?.cents === 2000 && v1.share.splitWays === 3, `need 3, nobody in: ${JSON.stringify(v1.share)}`);
    for (const k of ["ava", "jordan", "tyler", "zoe"]) expect((await pounce.pawIn(U[k], p.planId, { limitCents: 3000, confirmOverBudget: true })).ok, `${k} paw-in`);
    const v2 = await plans.planView(p.planId, U.marcus);
    expect(v2.share?.cents === 1200 && v2.share.splitWays === 5, `4 in, the fifth: ${JSON.stringify(v2.share)}`);
    await plans.setSplit(U.ava, p.planId, { splitMode: "weights", members: [{ userId: U.jordan, weight: 2 }] });
    const v3 = await plans.planView(p.planId, U.jordan);
    expect(v3.share?.cents === 2400, `Jordan counts as 2 of 5: ${JSON.stringify(v3.share)}`);
    const res = (await pounce.tryPounce(p.planId, { hostTapped: true })) as { status: string; shares: Record<string, number> };
    expect(res.status === "pounced" && res.shares[U.jordan] === 2400 && res.shares[U.ava] === 1200, JSON.stringify(res));
    return `Tyler saw $20.00 (need 3); Marcus saw $12.00 (4 in, he'd be 5th); weights → Pounce charged Jordan $24.00, others $12.00`;
  });

  await at("CHAT", "Kitten chat tools + friend's kitten refuses money questions", async () => {
    const r = await kittenChat(U.ava, "how much have I spent with friends this month?");
    const f = await askFriendKitten(U.ava, U.jordan, "How much money does Jordan have left this month?");
    expect(f.status === "refused", JSON.stringify(f));
    expect(/\$\d/.test(r.text), `the kitten should answer with the month's numbers, got: ${r.text}`);
    return `"${r.text}" | ${f.text}`;
  });

  await at("NFR-3", "Money balances: ledger sums to zero; settled pots are empty", async () => {
    const zero = await ledgerSumsToZero(d);
    const cabinPot = await balance(d, acct.plan(cabin.planId));
    const bowlPot = await balance(d, acct.plan(bowling.planId));
    const picklePot = await balance(d, acct.plan(pickle.planId));
    expect(zero && cabinPot === 0 && bowlPot === 0 && picklePot === 0, `zero=${zero} cabin=${cabinPot} bowling=${bowlPot} pickle=${picklePot}`);
    return "whole ledger = 0; cabin, bowling and pickleball pots = $0.00";
  });

  const passed = results.filter((r) => r.ok).length;
  const blocked = results.filter((r) => r.blocked).length;
  console.log(`\n${passed}/${results.length} passed${blocked ? `, ${blocked} blocked by the unfunded payout balance` : ""}`);
  fs.mkdirSync(path.join(process.cwd(), ".spike"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".spike", "phase1-acceptance.json"), JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
