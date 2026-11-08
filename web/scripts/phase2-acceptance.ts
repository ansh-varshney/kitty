/**
 * Phase 2 acceptance (PRD §D1 Phase 2: AT-13, AT-17, AT-18, AT-24 + the other Phase 2 features), end to end against
 * the REAL PayPal sandbox and the AI chain (Groq → Gemini → code), on a fresh in-memory database.
 * Run from web/:  npm run accept:phase2
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/load-env";

loadEnv();
process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;

type Result = { id: string; name: string; ok: boolean; detail: string; ms: number };
const results: Result[] = [];
async function at(id: string, name: string, fn: () => Promise<string>) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, name, ok: true, detail, ms: Date.now() - t0 });
    console.log(`PASS ${id.padEnd(9)} ${name}  (${Date.now() - t0} ms)  ${detail}`);
  } catch (e) {
    const msg = (e as Error).message;
    results.push({ id, name, ok: false, detail: msg, ms: Date.now() - t0 });
    console.log(`FAIL ${id.padEnd(9)} ${name}  ${msg}`);
  }
}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

async function main() {
  const { db } = await import("../lib/db");
  const { seedDemoWorld } = await import("../lib/core/seed");
  const yarn = await import("../lib/core/yarn");
  const help = await import("../lib/core/help");
  const party = await import("../lib/core/party");
  const catnip = await import("../lib/core/catnip");
  const bowl = await import("../lib/core/bowl");
  const meows = await import("../lib/core/meows");
  const purrs = await import("../lib/core/purrs");
  const exp = await import("../lib/core/export");
  const { myMonth } = await import("../lib/core/mymonth");
  const { runJobs } = await import("../lib/core/jobs");
  const whims = await import("../lib/core/whims");
  const plans = await import("../lib/core/plans");
  const pounce = await import("../lib/core/pounce");
  const users = await import("../lib/core/users");
  const { kittenChat } = await import("../lib/kitten/chat");
  const { acct, balance, ledgerSumsToZero } = await import("../lib/core/ledger");
  const { squadFeed, diary } = await import("../lib/core/events");

  const d = await db();
  console.log("Seeding demo friends (6 real sandbox Treat Jar top-ups)…");
  const w = await seedDemoWorld({ jarTopUpCents: 4000 });
  const U = w.users;
  const crew = w.squadId;
  let helpId = "";
  let bowlId = "";
  const who = (id: string) => Object.keys(U).find((k) => U[k] === id);

  await at("AT-13", "Yarn: 3 \"I paid\" cards confirmed → Untangle ≤ 3 payments → everyone at zero", async () => {
    const c1 = await yarn.logIPaid(U.ava, { squadId: crew, cents: 4800, note: "dinner", forUserIds: [U.jordan, U.tyler] });
    const c2 = await yarn.logIPaid(U.jordan, { squadId: crew, cents: 3000, note: "cab", forUserIds: [U.ava] });
    const c3 = await yarn.logIPaid(U.tyler, { squadId: crew, cents: 9000, note: "groceries", forUserIds: [U.ava, U.jordan] });
    const c4 = await yarn.logIPaid(U.zoe, { squadId: crew, cents: 2000, note: "snacks", forUserIds: [U.ava] });
    // Not counted until everyone on it confirms; a disputed card is paused (FR-YARN-2).
    expect((await yarn.myYarn(U.jordan))[0].youOweCents === 0, "a card counted before confirmation");
    for (const [card, k] of [[c1, "jordan"], [c1, "tyler"], [c2, "ava"], [c3, "ava"], [c3, "jordan"]] as const) await yarn.respondCard(U[k], card.cardId, true);
    expect((await yarn.respondCard(U.ava, c4.cardId, false)).status === "disputed", "dispute");
    const summary = await yarn.squadYarnSummary(crew);
    const r = await yarn.runUntangle(U.ava, crew);
    expect(r.transfers.length <= 3, `${r.transfers.length} transfers`);
    const planText = r.transfers.map((t) => `${who(t.from)}→${who(t.to)} ${usd(t.cents)}`);
    const open = await d.query<{ id: string; from_user: string }>(`select id, from_user from yarn_settlements where status='open'`);
    const outcome: string[] = [];
    for (const s of open) { const pr = await yarn.paySettlement(s.from_user, s.id); outcome.push("payoutBatchId" in pr && pr.payoutBatchId ? "paid out" : "no payout"); }
    const after = await yarn.squadYarnSummary(crew);
    const feed = await squadFeed(d, crew, 0, 200);
    const leak = feed.some((e) => /\$\d/.test(JSON.stringify(e.public)));
    expect(after.open === 0 && (await balance(d, acct.yarn(crew))) === 0, `after: ${after.text}`);
    expect(!leak, "the squad feed shows an amount (FR-YARN-6)");
    return `before: ${summary.text}; untangle: ${planText.join(", ")}; both paid (${outcome.join(", ")}); now "${after.text}"; the disputed card stayed out; no amounts in the squad feed`;
  });

  await at("AT-24", "Kitty Party: different amounts, savings pay only their owner's share, jar = sum of members", async () => {
    const p = await party.createParty(U.ava, crew, { name: "Goa fund", goalCents: 50000 });
    for (const [k, c] of [["ava", 2000], ["jordan", 1500], ["zoe", 1000]] as const) await party.joinParty(U[k], crew, c);
    for (const k of ["ava", "jordan", "zoe"]) await party.collectContribution(p.partyId, U[k]); // a second cycle
    const b1 = await party.memberBalances(d, crew);
    const jar1 = await party.jarTotal(d, crew);
    expect(b1[U.ava] === 4000 && b1[U.jordan] === 3000 && b1[U.zoe] === 2000 && jar1 === 9000, `balances ${JSON.stringify(b1)} jar ${jar1}`);
    // A $100 plan for Ava and Jordan: each $50 share uses their OWN savings first.
    const wh = await whims.createWhim(U.ava, { squadId: crew, what: "Beach day", startsAt: "2027-02-06T18:00:00Z", endsAt: "2027-02-06T22:00:00Z", priceCents: 10000, needAtLeast: 2 });
    const ans = (await whims.pendingAnswers(U.jordan)).filter((a) => a.whim_id === wh.whimId);
    const { plansCreated } = await whims.confirmAnswers(U.jordan, ans.map((a) => ({ answerId: a.id, answer: "yes" as const })));
    const planId = plansCreated[0];
    await plans.editPlan(U.ava, planId, { pounceRule: "host", needAtLeast: 2 });
    const pa = await pounce.pawIn(U.ava, planId, { limitCents: 5000, confirmOverBudget: true });
    const pj = await pounce.pawIn(U.jordan, planId, { limitCents: 5000, confirmOverBudget: true });
    expect(pa.ok && pj.ok && pa.savingsCents === 4000 && pj.savingsCents === 3000, `paw-ins ${JSON.stringify([pa, pj])}`);
    const pc = (await pounce.tryPounce(planId, { hostTapped: true })) as { status: string };
    expect(pc.status === "pounced", `pounce ${JSON.stringify(pc)}`);
    const b2 = await party.memberBalances(d, crew);
    const jar2 = await party.jarTotal(d, crew);
    const sum2 = Object.values(b2).reduce((a, c) => a + c, 0);
    expect((b2[U.ava] ?? 0) === 0 && (b2[U.jordan] ?? 0) === 0 && b2[U.zoe] === 2000 && jar2 === 2000 && sum2 === jar2, `after ${JSON.stringify(b2)} jar ${jar2}`);
    const v = await party.partyView(U.zoe, crew);
    expect(!/"balanceCents":(4000|3000)/.test(JSON.stringify(v)), "Zoe's view shows other members' savings");
    const wd = await party.withdrawSavings(U.zoe, crew);
    expect(wd.cents === 2000 && (await party.jarTotal(d, crew)) === 0, "withdraw");
    return `Ava $40, Jordan $30, Zoe $20 (jar $90 = sum); Beach day used $40 + $30 of savings; Zoe's $20 untouched (jar $20 = sum); Zoe withdrew $20 by Payout ${wd.payoutBatchId}`;
  });

  await at("AT-17", "Nine Lives: $300 asked, 3 pledges $250, partial accepted, ONE $250 Payout, declines invisible", async () => {
    const r = await help.askForHelp(U.marcus, { cents: 30000, note: "car repair", kind: "either", friendIds: [U.ava, U.jordan, U.tyler, U.zoe] });
    helpId = r.requestId;
    const [ask] = await d.query<{ suggested_cents: number }>(`select suggested_cents from help_asks where request_id=$1 and user_id=$2`, [r.requestId, U.ava]);
    await help.pledgeHelp(U.ava, r.requestId, { cents: 10000 });
    await help.pledgeHelp(U.jordan, r.requestId, { cents: 10000, asLoan: true });
    await help.pledgeHelp(U.tyler, r.requestId, { cents: 5000 });
    await help.declineHelp(U.zoe, r.requestId);
    const view = await help.helpView(U.marcus, r.requestId);
    const seen = JSON.stringify(view) + JSON.stringify(await diary(d, U.marcus, 100));
    expect(!/declin|zoe/i.test(seen), "the requester can see a decline");
    expect("pledgedCents" in view && view.pledgedCents === 25000 && view.helpers === 3, `view ${JSON.stringify(view)}`);
    const acc = await help.acceptHelp(U.marcus, r.requestId);
    expect(acc.receivedCents === 25000 && !!acc.payoutBatchId, JSON.stringify(acc));
    const loan = await d.query<{ cents: number; status: string }>(`select c.cents, c.status from yarn_cards c where c.kind='loan' and c.source_ref=$1`, [r.requestId]);
    expect(loan.length === 1 && loan[0].cents === 10000 && loan[0].status === "confirmed", `loan ${JSON.stringify(loan)}`);
    expect((await balance(d, acct.help(r.requestId))) === 0, "help pot not empty");
    return `kittens suggested ${usd(ask.suggested_cents)} (help rule); pledged $100 + $100 loan + $50; Zoe's decline invisible; accepted $250 → one Payout ${acc.payoutBatchId}; Jordan's loan is in Yarn (no interest)`;
  });

  await at("AT-18", "Catnip: the birthday person sees nothing, opt-in only, gone 3 days after the birthday", async () => {
    const soon = new Date(Date.now() + 5 * 86400_000).toISOString().slice(5, 10);
    await d.query(`update users set birth_date=make_date(1998,$2,$3), share_birthday=true where id=$1`, [U.judge, Number(soon.slice(0, 2)), Number(soon.slice(3, 5))]);
    const radar = await catnip.catnipRadar();
    const [g] = await d.query<{ id: string; birthday: string }>(`select id, birthday::text as birthday from gift_groups where birthday_user=$1`, [U.judge]);
    const invited = await d.query<{ status: string }>(`select status from gift_members where group_id=$1`, [g.id]);
    expect(radar.opened >= 1 && invited.length === 5 && invited.every((m) => m.status === "invited"), `radar ${JSON.stringify(radar)} members ${JSON.stringify(invited)}`);
    await catnip.joinGift(U.ava, g.id, 3000);
    await catnip.joinGift(U.zoe, g.id, 2000);
    await catnip.skipGift(U.tyler, g.id);
    const ideasView = await catnip.findGiftIdeas(U.ava, g.id);
    const ideas = "ideas" in ideasView && ideasView.ideas ? ideasView.ideas : [];
    expect(ideas.length >= 1, "no gift ideas");
    const view = await catnip.giftView(U.zoe, g.id);
    expect("joinedNames" in view && view.joinedNames?.length === 2 && !JSON.stringify(view).includes("Tyler") && view.budgetCents === 5000, `view ${JSON.stringify(view).slice(0, 200)}`);
    const pick = ideas.find((i) => i.price_cents && i.price_cents <= 5000) ?? ideas[0];
    if (!pick.price_cents || pick.price_cents > 5000) await d.query(`update gift_ideas set price_cents=4500 where id=$1`, [pick.id]);
    const gp = await catnip.startGiftPlan(U.ava, g.id, pick.id);
    // The birthday person: no catnip events, no gift squad, no gift plan, nothing in Meows (FR-NIP-3).
    const judgeEvents = await d.query(`select 1 from events where user_id=$1 and (type like 'catnip.%' or object_id=$2)`, [U.judge, g.id]);
    const judgeSquads = (await users.mySquads(d, U.judge)).filter((s) => s.kind === "gift");
    const judgePlans = await d.query(`select 1 from plans p join memberships m on m.squad_id=p.squad_id and m.user_id=$1 where p.id=$2`, [U.judge, gp.planId]);
    const judgeMeows = JSON.stringify(await meows.buildMeows(U.judge));
    expect(!judgeEvents.length && !judgeSquads.length && !judgePlans.length && !/gift|birthday/i.test(judgeMeows), "the birthday person can see something");
    let threw = false;
    try {
      await catnip.giftView(U.judge, g.id);
    } catch {
      threw = true;
    }
    expect(threw, "the birthday person could open the gift group");
    const cleanup = await catnip.catnipCleanup(new Date(Date.parse(`${g.birthday}T00:00:00Z`) + 4 * 86400_000 + 60_000));
    const [after] = await d.query<{ status: string }>(`select status from gift_groups where id=$1`, [g.id]);
    const left = await d.query(`select 1 from gift_ideas where group_id=$1 union all select 1 from gift_members where group_id=$1`, [g.id]);
    expect(cleanup.deleted >= 1 && after.status === "deleted" && left.length === 0, `after ${after.status}, rows left ${left.length}`);
    return `radar invited 5 friends privately; Ava + Zoe joined (budget $50), Tyler's skip invisible; ${ideas.length} idea(s) from ${ideas[0].source}; gift plan made; Judge saw nothing; deleted after the birthday`;
  });

  await at("BOWL", "The Bowl: shares → one Payout to the account holder; a seat leaves → reshare; a miss → Yarn strand", async () => {
    const b = await bowl.createBowl(U.tyler, { squadId: crew, service: "Spotify Family", totalCents: 1699, seats: 3, memberIds: [U.ava, U.zoe] });
    bowlId = b.bowlId;
    await bowl.joinBowl(U.ava, b.bowlId);
    await bowl.joinBowl(U.zoe, b.bowlId);
    const c1 = await bowl.bowlCycle(b.bowlId);
    expect(c1.collectedCents === 1132 && c1.missed === 0 && !!c1.payoutBatchId, JSON.stringify(c1));
    const l = await bowl.leaveBowl(U.zoe, b.bowlId);
    const c2 = await bowl.bowlCycle(b.bowlId); // Ava hasn't confirmed her new share yet → missed → Yarn strand
    const strand = await d.query(`select 1 from yarn_cards where note like 'Spotify Family share (missed)'`);
    expect(l.newShares[U.ava] === 849 && c2.missed === 1 && strand.length === 1, `reshare ${JSON.stringify(l)} cycle ${JSON.stringify(c2)}`);
    await bowl.joinBowl(U.ava, b.bowlId);
    const c3 = await bowl.bowlCycle(b.bowlId);
    expect(c3.collectedCents === 849 && (await balance(d, acct.bowl(b.bowlId))) === 0, JSON.stringify(c3));
    return `shares $5.66 × 2 → Payout ${c1.payoutBatchId} to Tyler; Zoe left → Ava's share $8.49 (confirm first); unconfirmed cycle → a Yarn strand; confirmed → collected`;
  });

  await at("MEOWS", "Meows sections, one-tap actions, and alerts that respect quiet hours", async () => {
    await yarn.logIPaid(U.tyler, { squadId: crew, cents: 1200, note: "coffee", forUserIds: [U.ava] });
    const m = await meows.buildMeows(U.ava);
    const keys = Object.keys(m.sections);
    const needs = m.sections.needsYou;
    expect(keys.join() === "whatIDid,needsYou,comingUp,yourMonth,littleSomething" && needs.length >= 1 && needs.every((n) => n.action?.path), `meows ${JSON.stringify(m).slice(0, 200)}`);
    await d.query(`update users set quiet_start='00:00', quiet_end='23:59' where id=$1`, [U.marcus]);
    const quiet = await meows.alerts(U.marcus);
    await d.query(`update users set quiet_start='22:00', quiet_end='08:00' where id=$1`, [U.marcus]);
    expect(quiet.quiet && quiet.items.length === 0, JSON.stringify(quiet));
    return `"${m.hello}" · ${needs.length} needs-you item(s), e.g. "${needs[0].text}" → ${needs[0].action?.method} ${needs[0].action?.path}; quiet hours hold alerts back`;
  });

  await at("PURRS", "Purrs and collar tags from the event log; Top Cat and streak with no money shown", async () => {
    const r = await purrs.purrsScan();
    const ava = await purrs.myPurrs(U.ava);
    const sq = await purrs.squadPurrs(crew);
    const tags = (await d.query<{ tag: string }>(`select distinct tag from collar_tags`)).map((t) => t.tag);
    expect(ava.purrs > 0 && tags.includes("Lifesaver") && tags.includes("Clutch") && sq.topCat, `purrs ${ava.purrs} tags ${tags}`);
    expect(!/cents|\$\d/.test(JSON.stringify(sq)), "the squad view shows money");
    return `${r.events} events scanned; tags awarded: ${tags.join(", ")}; Top Cat ${sq.topCat?.name} (${sq.topCat?.purrs} purrs), streak ${sq.streak}`;
  });

  await at("MONTH", "My Month: meter, by kind and squad, owed, saved, calendar (owner only)", async () => {
    const m = await myMonth(U.ava);
    const k = m.money.byKind;
    const sum = k.plans + k.gifts + k.yarn + k.help + k.bowl;
    expect(sum === m.money.meter.spentCents && k.yarn > 0 && k.help === 10000 && k.bowl > 0, `byKind ${JSON.stringify(k)} meter ${JSON.stringify(m.money.meter)}`);
    return `spent ${usd(m.money.meter.spentCents)} (plans ${usd(k.plans)}, yarn ${usd(k.yarn)}, help ${usd(k.help)}, bowl ${usd(k.bowl)}); owes ${usd(m.money.owed.youOweCents)}, owed ${usd(m.money.owed.owedToYouCents)}; ${m.calendar.plans.length} plan(s) in the calendar`;
  });

  await at("CHAT2", "New chat tools: I paid, what do I owe, Kitty Party, top-up (confirm card only)", async () => {
    const t0 = await d.query<{ n: number }>(`select count(*)::int as n from ledger`);
    const a = await kittenChat(U.jordan, "I paid $24 for coffee for Ava and Tyler");
    const b = await kittenChat(U.jordan, "what do I owe?");
    const c = await kittenChat(U.ava, "how's our kitty party?");
    const e = await kittenChat(U.ava, "top up my treat jar with $10");
    const t1 = await d.query<{ n: number }>(`select count(*)::int as n from ledger`);
    expect(/logged/i.test(a.text) && /coffee/i.test(a.text) && b.text.length > 5 && /goa fund/i.test(c.text) && e.card?.type === "confirm" && t0[0].n === t1[0].n, `${a.text} | ${b.text} | ${c.text} | ${e.text}`);
    return `"${a.text.slice(0, 70)}" | "${b.text}" | "${c.text.slice(0, 60)}" | top-up asks to confirm, no money moved`;
  });

  await at("EXPORT", "CSV (Diary, My Month) and a private calendar feed", async () => {
    const diaryCsv = await exp.diaryCsv(U.ava);
    const monthCsv = await exp.monthCsv(U.ava);
    const token = await exp.calendarToken(U.ava);
    const feed = await exp.calendarFeed(token);
    const bad = await exp.calendarFeed("not-a-real-token-123456");
    expect(diaryCsv.startsWith('"time","what"') && diaryCsv.split("\r\n").length > 5 && monthCsv.includes('"meter","spent"') && feed?.includes("BEGIN:VCALENDAR") && feed.includes("SUMMARY:Beach day") && bad === null, "export");
    return `diary ${diaryCsv.split("\r\n").length - 1} rows; month ${monthCsv.split("\r\n").length - 1} rows; calendar feed with ${(feed!.match(/BEGIN:VEVENT/g) ?? []).length} events; a wrong token gets nothing`;
  });

  await at("JOBS", "Every scheduled job runs cleanly in one call", async () => {
    const r = await runJobs();
    const errors = Object.entries(r).filter(([, v]) => v && typeof v === "object" && "error" in (v as object));
    expect(!errors.length, `errors: ${JSON.stringify(errors)}`);
    return `ran: ${Object.keys(r).filter((k) => k !== "ranAt").join(", ")}`;
  });

  await at("NFR-3", "Money balances: ledger sums to zero; Yarn, help and Bowl pots are empty", async () => {
    const zero = await ledgerSumsToZero(d);
    const pots = [await balance(d, acct.yarn(crew)), await balance(d, acct.help(helpId)), await balance(d, acct.bowl(bowlId))];
    expect(zero && pots.every((p) => p === 0), `zero=${zero} pots=${pots}`);
    return "whole ledger = 0; Yarn, Nine Lives and Bowl pass-through pots = $0.00";
  });

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  fs.mkdirSync(path.join(process.cwd(), ".spike"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), ".spike", "phase2-acceptance.json"), JSON.stringify(results, null, 2));
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
