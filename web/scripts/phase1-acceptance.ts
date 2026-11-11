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
  async function makePlan(host: string, opts: { squadId?: string; friends?: string[]; what: string; startsAt: string; endsAt?: string; priceCents: number; need: number; yes: string[]; useSavings?: boolean }) {
    // Everyone named says yes before it tips over into a plan, then "need at least" is set to what the test wants.
    const w = await whims.createWhim(U[host], { squadId: opts.squadId, friendIds: opts.friends?.map((f) => U[f]), what: opts.what, place: "Somewhere nice", startsAt: opts.startsAt, endsAt: opts.endsAt, priceCents: opts.priceCents, needAtLeast: opts.yes.length + 1, useSavings: opts.useSavings });
    let planId = "";
    for (const f of opts.yes) {
      const pend = (await whims.pendingAnswers(U[f])).filter((a) => a.whim_id === w.whimId);
      const r = await whims.confirmAnswers(U[f], pend.map((a) => ({ answerId: a.id, answer: "yes" as const })));
      if (r.plansCreated[0]) planId = r.plansCreated[0];
    }
    expect(planId, `plan for ${opts.what} was not created`);
    if (opts.need !== opts.yes.length + 1) await plans.editPlan(U[host], planId, { needAtLeast: opts.need });
    return { planId, whimId: w.whimId, squadId: w.squadId };
  }

  await at("AT-1", "Sign-up: 5 pages of data, kitten, rules, squad", async () => {
    const u = await users.upsertPayPalUser(d, { payerId: "TEST-NEWBIE", name: "Riley", email: "riley.kt26@personal.example.com", emailVerified: true });
    let rejected = false;
    try {
      await users.completeOnboarding(d, u.id, { name: "Riley", gender: "woman", birthDate: "2001-01-01", shareBirthday: true, interests: ["food"], kitten: { name: "Bean", breed: "tabby", look: { fur: "smoke", pattern: "plain", accessory: "scarf", eyes: "green" } }, rules: { funBudgetCents: 20000, freeHandCents: 1500, helpCents: 2000 } });
    } catch {
      rejected = true;
    }
    expect(rejected, "onboarding with only 1 interest should be rejected (min 3)");
    await users.completeOnboarding(d, u.id, { name: "Riley", gender: "woman", birthDate: "2001-01-01", shareBirthday: true, interests: ["food", "movies", "travel"], kitten: { name: "Bean", breed: "tabby", look: { fur: "smoke", pattern: "plain", accessory: "scarf", eyes: "green" } }, rules: { funBudgetCents: 20000, freeHandCents: 1500, helpCents: 2000 } });
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
    const w = await whims.createWhim(U.tyler, { squadId: crew, what: "Escape room", place: "Downtown", priceCents: 3000, startsAt: day("2026-12-05T18:00:00Z"), endsAt: day("2026-12-05T20:00:00Z"), needAtLeast: 6 });
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

  await at("AT-5", "Full Pounce: 4 of 4 in, exact shares, the pot lands in the booker's Treat Jar", async () => {
    const before = await balance(d, acct.jar(U.ava));
    const res = (await pounce.tryPounce(bowling.planId, { hostTapped: true })) as { status: string };
    expect(res.status === "pounced", JSON.stringify(res));
    const [pc] = await d.query<{ total_cents: number; shares: Record<string, number> }>(`select total_cents, shares from pounces where plan_id=$1`, [bowling.planId]);
    expect(pc.total_cents === 12000 && Object.values(pc.shares).every((s) => s === 3000), `shares ${JSON.stringify(pc.shares)}`);
    expect((await balance(d, acct.jar(U.ava))) === before + 12000, "the pot didn't reach the booker's jar");
    return "4 × $30.00 from Treat Jars; $120.00 in Ava's Treat Jar, ready to book with";
  });

  await seedSavings(crew, U.jordan, 6000);
  const cabin = await makePlan("ava", { squadId: crew, what: "Cabin trip", startsAt: day("2026-12-12T16:00:00Z"), endsAt: day("2026-12-14T16:00:00Z"), priceCents: 70000, need: 4, yes: ["jordan", "tyler", "zoe", "marcus"], useSavings: true });

  await at("AT-10", "Kitty Party money first when the host chose it: $60 savings + $80 Treat Jar for a $140 share", async () => {
    const paws = await d.query<{ source: string; cents: number }>(`select source, cents from paws where plan_id=$1 and user_id=$2 and status='held' order by source`, [cabin.planId, U.jordan]);
    expect(paws.find((p) => p.source === "savings")?.cents === 6000 && paws.find((p) => p.source === "jar")?.cents === 8000, JSON.stringify(paws));
    return paws.map((p) => `${p.source} ${p.cents}`).join(", ");
  });

  await at("AT-7", "Only the host's tap Pounces, and each person pays exactly their share", async () => {
    const done = (await pounce.tryPounce(cabin.planId, { hostTapped: true })) as { status: string; shares: Record<string, number> };
    expect(done.status === "pounced" && Object.values(done.shares).every((s) => s === 14000), JSON.stringify(done));
    return "$140.00 × 5 = $700.00";
  });


  await at("AT-12", "Receipt under budget: $20 leftover back by share, to each source", async () => {
    const r = await receipts.submitReceipt(U.ava, cabin.planId, { cents: 68000 });
    const res = await receipts.confirmReceipt(U.ava, r.receiptId, 68000);
    expect("kind" in res && res.kind === "leftover" && res.leftoverCents === 2000, JSON.stringify(res));
    const back = (res as { refunds: { userId: string; source: string; cents: number }[] }).refunds;
    const total = back.reduce((a, b) => a + b.cents, 0);
    expect(total === 1600 && (res as { bookerReturnedCents: number }).bookerReturnedCents === 1600, `others got ${total}`);
    const jordanParts = back.filter((b) => b.userId === U.jordan);
    expect(jordanParts.some((b) => b.source === "savings") && jordanParts.some((b) => b.source === "jar"), "Jordan's $4 should split savings/Treat Jar");
    return `$4.00 each; Ava returned $16.00; Jordan's $4 → ${jordanParts.map((b) => `${b.source} ${b.cents}`).join(" + ")}`;
  });

  await at("AT-9", "Tag along: the host says yes, the newcomer pays the new share, and refunds add up exactly", async () => {
    const asked = (await pounce.tagAlong(U.judge, cabin.planId)) as { status: string };
    expect(asked.status === "asked", JSON.stringify(asked));
    const [req] = await d.query<{ id: string }>(`select id from tag_requests where plan_id=$1 and user_id=$2`, [cabin.planId, U.judge]);
    const r = (await pounce.answerTagRequest(U.ava, req.id, true)) as { paid: boolean; newcomerPays: number; refunds: Record<string, number> };
    expect(r.paid, JSON.stringify(r));
    const sum = Object.values(r.refunds).reduce((a, b) => a + b, 0);
    expect(sum === r.newcomerPays, `refunds ${sum} vs paid ${r.newcomerPays}`);
    return `Ava said yes; Judge paid ${r.newcomerPays}; refunds ${JSON.stringify(Object.values(r.refunds))}`;
  });

  const movie = await makePlan("tyler", { squadId: crew, what: "Movie night", startsAt: day("2026-12-22T02:00:00Z"), endsAt: day("2026-12-22T05:00:00Z"), priceCents: 6000, need: 4, yes: ["ava", "zoe"] });
  const pickle = await makePlan("ava", { squadId: crew, what: "Pickleball", startsAt: day("2026-12-20T17:00:00Z"), endsAt: day("2026-12-20T19:00:00Z"), priceCents: 8000, need: 3, yes: ["jordan", "tyler", "zoe"] });

  await at("AT-6", "Partial group: 6 invited, 4 in, at least 3: the host Pounces with who's in", async () => {
    const tick = await runTick(new Date(Date.now() + 49 * 3600_000));
    const res = (await pounce.tryPounce(pickle.planId, { hostTapped: true })) as { status: string };
    const [pc] = await d.query<{ group_ids: string[] }>(`select group_ids from pounces where plan_id=$1`, [pickle.planId]);
    expect(res.status === "pounced" && pc.group_ids.length === 4, `pickleball not pounced: ${JSON.stringify([res, tick.deadlines])}`);
    const others = await d.query(`select 1 from paws where plan_id=$1 and user_id = any($2)`, [pickle.planId, [U.marcus, U.judge]]);
    expect(others.length === 0, "Marcus/Judge should never be charged");
    return "4 × $20.00 from Treat Jars; Marcus and Judge never charged";
  });

  await at("AT-11", "Deadline miss: rule unmet → everything released", async () => {
    const [p] = await d.query<{ status: string }>(`select status from plans where id=$1`, [movie.planId]);
    const paws = await d.query<{ status: string }>(`select status from paws where plan_id=$1`, [movie.planId]);
    expect(p.status === "on_ice", `status ${p.status}`);
    expect(paws.length > 0 && paws.every((x) => x.status === "voided"), `paws ${JSON.stringify(paws)}`);
    return `on ice; ${paws.length} holds released`;
  });

  await at("AT-14", "Overspending guard: over the fun budget, the kitten privately suggests negotiating", async () => {
    await whims.createWhim(U.zoe, { friendIds: [U.judge], what: "Concert tickets", place: "The arena", startsAt: day("2026-12-27T03:00:00Z"), endsAt: day("2026-12-27T06:00:00Z"), priceCents: 62000, needAtLeast: 2 });
    const a = (await whims.pendingAnswers(U.judge)).find((x) => x.what === "Concert tickets");
    expect(a?.prepared === "negotiate", JSON.stringify(a));
    const held = await d.query(`select 1 from paws where user_id=$1 and status='held'`, [U.judge]);
    expect(held.length === 0, "money moved before anyone said yes");
    return a!.prepared_reason;
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
       where m.status='in' and m.limit_cents is null and m.user_id <> p.host_id and p.status <> 'on_ice'`, // on ice, everyone's money has gone back, so nobody has a share set
    );
    expect(auto.length === 0, `${auto.length} answer(s) confirmed with no owner tap`);
    expect(joinedWithoutPaw.length === 0, `in without a limit: ${joinedWithoutPaw.map((r) => `${r.name} @ ${r.title}`).join(", ")}`);
    return "every confirmed answer has an owner tap; nobody is 'in' without their own yes";
  });

  await at("AT-19", "Privacy: no one else's limit, reason or balance in views or feed", async () => {
    const view = JSON.stringify(await plans.planView(cabin.planId, U.jordan));
    expect(!view.includes(String(13000)) && !view.includes(String(16000)), "another member's limit leaked into Jordan's view");
    const feed = await squadFeed(d, crew, 0, 500);
    const leaks = feed.filter((e) => Object.keys(e.public).some((k) => /cents|limit|balance|reason/i.test(k)));
    expect(leaks.length === 0, `feed leaks: ${JSON.stringify(leaks[0])}`);
    return `Jordan's plan view has only his own limit; ${feed.length} feed items, none with amounts or reasons`;
  });

  await at("AT-21", "No double booking: in a plan → can't say yes to an overlapping one", async () => {
    const w = await whims.createWhim(U.ava, { friendIds: [U.tyler], what: "Dinner", place: "Bistro", startsAt: day("2026-12-04T19:00:00Z"), endsAt: day("2026-12-04T21:00:00Z"), priceCents: 8000, needAtLeast: 2 });
    const pend = (await whims.pendingAnswers(U.tyler)).filter((a) => a.whim_id === w.whimId);
    expect(pend[0]?.prepared === "negotiate", JSON.stringify(pend[0]));
    let blocked = "";
    await whims.confirmAnswers(U.tyler, [{ answerId: pend[0].id, answer: "yes" }]).catch((e: Error) => (blocked = e.message));
    expect(/already in/.test(blocked), `yes went through: ${blocked}`);
    const a = await makePlan("zoe", { friends: ["marcus"], what: "Trivia", startsAt: day("2027-01-08T03:00:00Z"), priceCents: 2000, need: 2, yes: ["marcus"] });
    const later = await whims.createWhim(U.zoe, { friendIds: [U.marcus], what: "Late dinner", place: "Diner", startsAt: day("2027-01-08T04:30:00Z"), priceCents: 2000, needAtLeast: 2 });
    const b = (await whims.pendingAnswers(U.marcus)).filter((x) => x.whim_id === later.whimId);
    await plans.respond(U.marcus, a.planId, "out");
    const ok = await whims.confirmAnswers(U.marcus, [{ answerId: b[0].id, answer: "yes" }]);
    expect(ok.plansCreated.length === 1, JSON.stringify(ok));
    return `Tyler blocked: "${blocked}"; Marcus withdrew from Trivia and could then say yes to Late dinner`;
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

  await at("AT-23", "Negotiation loop guard: one try each, the host decides, and the kittens' talk is on the whim", async () => {
    const start = day("2026-12-13T01:00:00Z");
    const w = await whims.createWhim(U.judge, { squadId: crew, what: "Game night", place: "Judge's place", startsAt: start, endsAt: day("2026-12-13T04:00:00Z"), priceCents: 3000, needAtLeast: 3 });
    await d.query(`insert into busy_blocks (user_id, starts_at, ends_at, label) values ($1,$2,$3,'test')`, [U.tyler, start, day("2026-12-13T04:00:00Z")]);
    const { askToNegotiate, answerNegotiation, whimView } = await import("../lib/core/negotiate");
    const first = await askToNegotiate(U.tyler, w.whimId);
    expect(first.status === "asked", JSON.stringify(first));
    const [n] = await d.query<{ id: string }>(`select id from whim_negotiations where whim_id=$1`, [w.whimId]);
    await answerNegotiation(U.judge, n.id, true);
    const again = await askToNegotiate(U.tyler, w.whimId);
    expect(again.status === "limit", JSON.stringify(again));
    const v = await whimView(U.zoe, w.whimId);
    expect(v.talk.length >= 3 && Date.parse(v.whim.startsAt!) !== Date.parse(start), JSON.stringify(v.talk));
    await whims.withdrawWhim(U.judge, w.whimId);
    return v.talk.map((t) => `${t.kitten} (${t.owner}): ${t.text}`).join(" / ");
  });


  await at("BOOKING", "The booker pays for the booking straight from their Treat Jar, by a real PayPal payout", async () => {
    const p = await makePlan("zoe", { friends: ["jordan"], what: "Mini golf", startsAt: day("2026-12-30T20:00:00Z"), endsAt: day("2026-12-30T22:00:00Z"), priceCents: 4000, need: 2, yes: ["jordan"] });
    const res = (await pounce.tryPounce(p.planId, { hostTapped: true })) as { status: string };
    expect(res.status === "pounced", JSON.stringify(res));
    const [j] = await d.query<{ paypal_email: string }>(`select paypal_email from users where id=$1`, [U.jordan]);
    const { payBooking } = await import("../lib/core/jar");
    const sent = await payBooking(U.zoe, p.planId, { email: j.paypal_email, cents: 4000 });
    expect(sent.batchId, JSON.stringify(sent));
    return `$40.00 from Zoe's Treat Jar, Payout ${sent.batchId}`;
  });

  await at("SHARE", "Everyone sees their share; those who said yes pay exactly that from their jar", async () => {
    const p = await makePlan("ava", { squadId: crew, what: "Brunch", startsAt: day("2027-01-10T18:00:00Z"), endsAt: day("2027-01-10T20:00:00Z"), priceCents: 6000, need: 3, yes: ["jordan", "tyler", "zoe", "marcus"] });
    const v = await plans.planView(p.planId, U.tyler);
    expect(v.share?.cents === 1200 && v.myShareCents === 1200 && v.myHeldCents === 1200, JSON.stringify([v.share, v.myShareCents, v.myHeldCents]));
    const res = (await pounce.tryPounce(p.planId, { hostTapped: true })) as { status: string; shares: Record<string, number> };
    expect(res.status === "pounced" && Object.values(res.shares).every((c) => c === 1200), JSON.stringify(res));
    return "$60.00 split 5 ways: $12.00 each";
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
