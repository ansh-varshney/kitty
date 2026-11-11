import { db, type Queryable } from "../db";
import { explainTerm } from "./glossary";
import { diary, logEvent } from "../core/events";
import { CARD_EVENTS } from "../core/describe";
import { ordinal } from "../referee/time";
import { openNeeds } from "../core/meows";
import { getKitten, getUser, kittenMemory, listRules, mySquads, setKittenMemory, sharesASquad, addCustomRule } from "../core/users";
import { calendar, committedCents, jarBalances, monthSpentCents } from "../core/month";
import { createWhim, pendingAnswers } from "../core/whims";
import { cardTurns, counterCard, logIPaid, myYarn, runUntangle } from "../core/yarn";
import { partyView } from "../core/party";
import { withLock } from "../core/locks";
import { myMonth } from "../core/mymonth";
import { remindNow } from "../core/reminders";
import { answerFromData, chatIntent, classifyQuestion } from "./ai";
import { PERSONALITIES } from "./looks";
import { funBudgetCents, shareable } from "../referee/rules";
import { clash, localToday, validTz, zonedToUtc } from "../referee/time";

/**
 * Talking to your kitten, and to a friend's kitten (PRD §B2, §B18, FR-CHAT-1..7, FR-KIT-5/6). Pinned at the top of
 * Squads. It answers from your own data, chats about anything, and can start anything the app can do. Anything that
 * moves money, or speaks for you, comes back as a card you tap (FR-CHAT-2, FR-WHIM-8); the referee still checks it.
 */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
const cents = (v: unknown) => Math.round(Number(String(v ?? "").replace(/[^0-9.]/g, "")) * 100);

type Act = { method: "GET" | "POST"; path: string; body?: Record<string, unknown> };
export type ChatReply = { text: string; card?: Record<string, unknown> };
const confirm = (label: string, action: Act, extra: Record<string, unknown> = {}) => ({ type: "confirm", label, action, ...extra });
const open = (label: string, href: string) => ({ type: "open", label, href });

/** Everything the kitten knows about its owner, for answering questions (FR-CHAT-6). Only ever this person's own data. */
async function factsAbout(d: Queryable, userId: string) {
  const [m, entries, memory, plans] = await Promise.all([
    myMonth(userId),
    diary(d, userId, 80),
    kittenMemory(d, userId),
    d.query<{ title: string; status: string; my: string; decide_by: string; starts_at: string | null; price_cents: number; price_mode: string; my_share: number | null }>(
      `select p.title, p.status, m.status as my, p.decide_by, p.starts_at, p.price_cents, p.price_mode,
         (select (x.shares->>($1::text))::int from pounces x where x.plan_id=p.id order by x.created_at desc limit 1) as my_share
       from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1::uuid order by p.decide_by desc limit 25`,
      [userId],
    ),
  ]);
  const groups = (await mySquads(d, userId)).filter((s) => s.kind === "squad");
  const parties = (await Promise.all(groups.map((s) => partyView(userId, s.id)))).flatMap((v) => (v.party ? [`${v.party.name} (Kitty Party): the jar has ${fmt(v.jarCents)}${v.party.goalCents ? ` of ${fmt(v.party.goalCents)}` : ""}${v.mine ? `, their own savings ${fmt(v.mine.balanceCents)}` : ""}.`] : []));
  const meter = m.money.meter;
  const su = m.money.settleUp;
  return [
    `This month: spent ${fmt(meter.spentCents)}, on hold ${fmt(meter.committedCents)}${meter.budgetCents != null ? `, fun budget ${fmt(meter.budgetCents)}` : ""}.`,
    `By squad: ${m.money.bySquad.map((s) => `${s.squad} ${fmt(s.cents)}`).join("; ") || "nothing yet"}.`,
    `By kind: ${Object.entries(m.money.byKind).filter(([, c]) => c).map(([k, c]) => `${k} ${fmt(c)}`).join("; ") || "nothing yet"}.`,
    `They owe ${fmt(su.totals.youOweCents)} in total; friends owe them ${fmt(su.totals.owedToYouCents)}.`,
    ...su.groups.flatMap((g) => g.strands.map((s) => `${g.squad}: ${s.text}`)),
    `Treat Jar: ${fmt(m.money.saved.treatJar.availableCents)} free, ${fmt(m.money.saved.treatJar.heldCents)} held.`,
    `Savings: ${m.money.saved.partySavings.map((s) => `${s.squad} ${fmt(s.cents)}`).join("; ") || "none"}.`,
    ...parties,
    `Plans: ${plans.map((p) => `${p.title} (${p.status}, they are ${p.my}, decide by ${String(p.decide_by).slice(0, 10)}, ${p.price_mode === "total" ? `whole group's price ${fmt(p.price_cents)}, not what they paid` : `price each ${fmt(p.price_cents)}`}, ${p.my_share != null ? `their own share paid ${fmt(p.my_share)}` : "they have paid nothing for it"})`).join("; ") || "none"}.`,
    memory.length ? `Things you remember: ${memory.join("; ")}.` : "",
    "Recent activity, newest first:",
    ...entries.filter((e) => !e.type.startsWith("chat.")).map((e) => `${String(e.createdAt).slice(0, 10)}: ${e.line}${e.reason ? ` (why: ${e.reason})` : ""}${e.paypalId ? ` [PayPal ID ${e.paypalId}]` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");
}

async function reply(userId: string, message: string): Promise<ChatReply> {
  const d = await db();
  const squads = await mySquads(d, userId);
  const real = squads.filter((s) => s.kind !== "gift");
  const kitten = await getKitten(d, userId);
  const tone = PERSONALITIES.find((p) => p.breed === kitten?.breed)?.label.toLowerCase() ?? "friendly";
  const friends = await d.query<{ id: string; name: string }>(
    `select distinct u.id, u.name from memberships a join memberships b on a.squad_id=b.squad_id join users u on u.id=b.user_id
     where a.user_id=$1 and b.user_id<>$1 and a.left_at is null and b.left_at is null`,
    [userId],
  );
  const term = explainTerm(message);
  if (term) {
    await logEvent(d, { userId, actor: "user", actorId: userId, type: "chat.message", payload: { message, tool: "glossary" } });
    return { text: term };
  }
  const { tool, args } = await chatIntent(message, friends.map((f) => f.name), tone);
  await logEvent(d, { userId, actor: "user", actorId: userId, type: "chat.message", payload: { message, tool } });

  const friendNamed = () => friends.find((f) => f.name.toLowerCase() === (args.friend ?? "").toLowerCase()) ?? friends.find((f) => message.toLowerCase().includes(f.name.toLowerCase()));
  const squadNamed = () => real.find((s) => s.name.toLowerCase() === (args.squad ?? "").toLowerCase()) ?? real.find((s) => message.toLowerCase().includes(s.name.toLowerCase()));

  /** Did they name something specific? "The plan" or "it" isn't a name, so the only open one is fine for those. */
  const namedOne = (x?: string) => Boolean(x?.trim()) && !/^(the |my |this |that )?(plan|whim|one|it|trip)$/i.test(x!.trim());

  /** A plan by name, or the only one that's open if they didn't name a different one. */
  const planNamed = async (statuses = ["open", "pounced"]) => {
    const open = await d.query<{ id: string; title: string; host_id: string; status: string }>(
      `select p.id, p.title, p.host_id, p.status from plans p join memberships ms on ms.squad_id=p.squad_id and ms.user_id=$1 and ms.left_at is null where p.status = any($2::text[]) order by p.decide_by`,
      [userId, statuses],
    );
    const said = (args.plan ?? message).toLowerCase();
    return open.find((p) => said.includes(p.title.toLowerCase()) || p.title.toLowerCase().split(/\s+/).some((w) => w.length >= 4 && said.includes(w))) ?? (open.length === 1 && !namedOne(args.plan) ? open[0] : null);
  };
  const noPlan = { text: "Which plan do you mean? I couldn't tell." };
  /** A whim waiting for an answer, by name, or the only one there is if they didn't name a different one. */
  const whimNamed = <T extends { what: string }>(list: T[]) => {
    const said = (args.whim ?? message).toLowerCase();
    return list.find((w) => said.includes(w.what.toLowerCase()) || w.what.toLowerCase().split(/\s+/).some((x) => x.length >= 4 && said.includes(x))) ?? (list.length === 1 && !namedOne(args.whim) ? list[0] : null);
  };

  /** Changes other kittens have asked for on whims this person floated, waiting on their answer. */
  const asksOfMe = () => d.query<{ id: string; what: string }>(`select n.id, w.what from whim_negotiations n join whims w on w.id=n.whim_id where w.owner_id=$1 and n.status='with_host' and w.status='floating'`, [userId]);
  const decideAsk = (n: { id: string; what: string }) => {
    const keep = /\b(keep|no|don'?t|reject|leave)\b/i.test(args.answer ?? message);
    return { text: keep ? `Keep "${n.what}" as it is?` : `Accept the change to "${n.what}"? Everyone gets asked again.`, card: confirm(keep ? "Keep it as it is" : "Accept", { method: "POST", path: `negotiations/${n.id}/${keep ? "keep" : "accept"}` }) };
  };

  /** People asking this host if they can tag along. */
  const tagAsksOfMe = () => d.query<{ id: string; who: string; what: string }>(`select r.id, u.name as who, p.title as what from tag_requests r join plans p on p.id=r.plan_id join users u on u.id=r.user_id where p.host_id=$1 and r.status='asked' order by r.created_at`, [userId]);
  const whichAsk = (asks: { id: string; who: string; what: string }[]) => {
    const said = `${args.friend ?? ""} ${args.plan ?? ""} ${message}`.toLowerCase();
    return asks.find((a) => said.includes(a.who.toLowerCase())) ?? asks.find((a) => said.includes(a.what.toLowerCase())) ?? (asks.length === 1 ? asks[0] : undefined);
  };
  const decideTag = (a: { id: string; who: string; what: string }) => {
    const no = /\b(no|not|don'?t|decline|reject|refuse)\b/i.test(args.answer ?? message);
    return { text: no ? `Tell ${a.who} no for "${a.what}"?` : `Let ${a.who} tag along on "${a.what}"? Their share comes from their Treat Jar, and everyone else gets some back.`, card: confirm(no ? "Say no" : "Say yes", { method: "POST", path: `tag-requests/${a.id}/${no ? "decline" : "accept"}` }) };
  };
  // A host answering someone who asked to tag along, whichever tool the model reached for.
  if (/\btag(ging)?[ -]?along\b/i.test(message) && /\b(yes|no|not|ok|okay|sure|accept|approve|allow|let|don'?t|decline|reject|refuse)\b/i.test(message)) {
    const a = whichAsk(await tagAsksOfMe());
    if (a) return decideTag(a);
  }

  // "Accept" or "keep" on one of your whims is your answer to a kitten, whichever tool the model reached for.
  if (/\b(accept|approve|keep)\b/i.test(message)) {
    const asks = await asksOfMe();
    const said = message.toLowerCase();
    const n = asks.find((a) => said.includes(a.what.toLowerCase())) ?? (asks.length === 1 && /\b(change|negotiation|request)\b/i.test(message) ? asks[0] : undefined);
    if (n) return decideAsk(n);
  }

  switch (tool) {
    case "create_whim": {
      // The kitten never floats a whim on its own (FR-WHIM-8). It reads what you said into the form, and you check the price and details.
      const text = args.text ?? message;
      const named = squadNamed();
      if (!real.length) return { text: "Make a squad first, then we can plan something." };
      return { text: `Let's set up "${text}".`, card: { type: "whim", label: "Set it up", text, squadId: named?.id ?? null } };
    }
    case "my_plans": {
      const plans = await d.query<{ id: string; title: string; status: string; decide_by: string }>(
        `select p.id, p.title, p.status, p.decide_by from plans p join plan_members m on m.plan_id=p.id and m.user_id=$1 where p.status in ('open','pounced') order by p.decide_by`,
        [userId],
      );
      return { text: plans.length ? `You have ${plans.length} plan${plans.length > 1 ? "s" : ""} on the go.` : "No plans right now. Float a whim?", card: { type: "plans", plans } };
    }
    case "my_jar": {
      const j = await jarBalances(d, userId);
      return { text: `Your Treat Jar has ${fmt(j.availableCents)} free and ${fmt(j.heldCents)} set aside for plans.`, card: { type: "jar", ...j } };
    }
    case "my_month": {
      const rules = await listRules(d, userId);
      const budget = funBudgetCents(rules);
      const spent = await monthSpentCents(d, userId);
      const committed = await committedCents(d, userId);
      return {
        text: budget != null ? `You've spent ${fmt(spent)} of your ${fmt(budget)} fun budget, with ${fmt(committed)} committed.` : `You've spent ${fmt(spent)} with friends this month.`,
        card: { type: "month", spentCents: spent, committedCents: committed, budgetCents: budget },
      };
    }
    case "add_rule": {
      const r = await addCustomRule(d, userId, args.text ?? message);
      return r.ok ? { text: `Got it: ${r.plain}`, card: { kind: "rule", ruleType: r.type, plain: r.plain, replaced: r.replaced } } : { text: r.error };
    }
    case "ask_friend": {
      const friend = friendNamed();
      if (!friend) return { text: "Which friend? I can only ask kittens of friends in your squads." };
      const res = await askFriendKitten(userId, friend.id, args.question ?? message);
      return { text: res.relayed, card: { type: "friend_answer", ...res } };
    }
    case "explain": {
      const [last] = (await diary(d, userId, 40)).filter((e) => e.actor === "kitten" && !e.type.startsWith("chat."));
      return { text: last ? `Last thing I did: ${last.line} Why: ${last.reason ?? "you asked me to"}.` : "I haven't done anything on my own yet." };
    }
    case "log_i_paid": {
      // Not money moving: it creates a card each friend confirms (FR-YARN-2).
      const amount = cents(args.dollars);
      const names = String(args.friends ?? "").split(/,|\band\b/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const people = friends.filter((f) => names.includes(f.name.toLowerCase()));
      const squad = squadNamed() ?? real.find((s) => s.kind === "squad");
      if (!amount || !people.length || !squad) return { text: "Tell me the amount and who it was for, like \"I paid $48 for dinner for Jordan and Tyler\"." };
      // "for coffee for Ava and Tyler": if the model left the note out, take it from the words themselves.
      const note = (args.note?.trim() || /\bfor\s+(.+?)\s+for\b/i.exec(message)?.[1] || "something").slice(0, 60);
      const r = await logIPaid(userId, { squadId: squad.id, cents: amount, note, forUserIds: people.map((p) => p.id) });
      return { text: `Logged it: you paid ${fmt(amount)} for ${note}. ${people.map((p) => p.name).join(" and ")} will confirm with one tap.`, card: { type: "yarn_card", ...r } };
    }
    case "my_yarn": {
      const y = await myYarn(userId);
      const owe = y.reduce((a, s) => a + s.youOweCents, 0);
      const owed = y.reduce((a, s) => a + s.owedToYouCents, 0);
      const why = y.flatMap((s) => s.strands).slice(0, 3).map((s) => s.text).join(" ");
      return { text: owe || owed ? `You owe ${fmt(owe)}, and friends owe you ${fmt(owed)}.${why ? ` ${why}` : ""}` : "All untangled. Nobody owes anybody.", card: owe || owed ? { type: "open", label: "Settle up", href: "/month" } : { type: "yarn", squads: y } };
    }
    case "untangle": {
      const squad = squadNamed() ?? real.find((s) => s.kind === "squad");
      if (!squad) return { text: "Join a squad first." };
      const r = await runUntangle(userId, squad.id);
      const mine = r.transfers.filter((t) => t.from === userId);
      return { text: r.transfers.length ? `Untangled ${squad.name} into ${r.transfers.length} payment${r.transfers.length > 1 ? "s" : ""}.${mine.length ? ` Yours: ${fmt(mine.reduce((a, t) => a + t.cents, 0))}. Tap to pay.` : " Nothing for you to pay."}` : `${squad.name} is all untangled.`, card: mine.length ? open("Settle up", "/month") : { type: "untangle", ...r } };
    }
    case "tell_friend": {
      const friend = friendNamed();
      const said = (args.text ?? "").trim();
      if (!friend) return { text: "Who should I tell?" };
      if (!said) return { text: `What should I tell ${friend.name}?` };
      return { text: `Tell ${friend.name}: "${said}"?`, card: confirm("Send it", { method: "POST", path: `friends/${friend.id}/messages`, body: { mode: "my_kitten", text: said } }) };
    }
    case "change_card": {
      // "That dinner should be $10": you ask, your kitten goes and sorts it out with theirs.
      const turns = await cardTurns(d, userId);
      const about = (args.note ?? message).toLowerCase();
      const t = turns.find((x) => about.includes(x.note.toLowerCase())) ?? (turns.length === 1 ? turns[0] : undefined);
      if (!t) return { text: turns.length ? `Which one? ${turns.map((x) => x.note).join(", ")}.` : "No card is waiting on you right now." };
      await counterCard(userId, t.card_id, { text: args.text ?? message, forUser: t.part_user === userId ? undefined : t.part_user });
      return { text: `On it. I told ${t.part_user === userId ? t.payer_name : t.debtor_name}'s kitten about ${t.note}. I'll tell you what comes back.` };
    }
    case "pay_friend": {
      const friend = friendNamed();
      const rows = await d.query<{ id: string; cents: number; name: string }>(
        `select s.id, s.cents, u.name from yarn_settlements s join users u on u.id=s.to_user where s.from_user=$1 and s.status='open' ${friend ? "and s.to_user=$2" : ""} order by s.created_at limit 1`,
        friend ? [userId, friend.id] : [userId],
      );
      if (!rows.length) return { text: friend ? `Nothing's ready to pay ${friend.name} yet. Want me to untangle first?` : "Nothing's ready to pay right now.", card: open("Settle up", "/month") };
      return { text: `Pay ${rows[0].name} ${fmt(rows[0].cents)}?`, card: confirm(`Pay ${fmt(rows[0].cents)}`, { method: "POST", path: `yarn/settlements/${rows[0].id}/pay` }) };
    }
    case "remind": {
      const friend = friendNamed();
      if (!friend) return { text: "Who should I remind?" };
      const r = await remindNow(userId, friend.id);
      return { text: r.text };
    }
    case "plan_in": {
      const p = await planNamed(["open", "pounced", "settled"]);
      if (!p) return noPlan;
      const [mine] = await d.query<{ status: string }>(`select status from plan_members where plan_id=$1 and user_id=$2`, [p.id, userId]);
      if (mine?.status === "in") return { text: `You're already in "${p.title}".` };
      if (p.status === "open") return { text: `Join "${p.title}"? Your share comes from your Treat Jar.`, card: confirm("Join", { method: "POST", path: `plans/${p.id}/tag-along` }) };
      return { text: `"${p.title}" is final, so I'll ask the host. If they say yes, your share comes from your Treat Jar.`, card: confirm("Ask to tag along", { method: "POST", path: `plans/${p.id}/tag-along` }) };
    }
    case "answer_tag_request": {
      const asks = await tagAsksOfMe();
      const a = whichAsk(asks);
      return a ? decideTag(a) : { text: asks.length ? "Who do you mean?" : "Nobody's asking to tag along right now." };
    }
    case "plan_out": {
      const p = await planNamed();
      if (p && p.host_id === userId) return { text: `You're the host of "${p.title}", so you're in. Want to call it off instead? Everyone's money goes back.`, card: confirm("Cancel the plan", { method: "POST", path: `plans/${p.id}/cancel` }) };
      return p ? { text: `Take you out of "${p.title}"? Your money goes back to you, and nobody is told why.`, card: confirm("Withdraw", { method: "POST", path: `plans/${p.id}/respond`, body: { status: "out" } }) } : noPlan;
    }
    case "cancel_plan": {
      const p = await planNamed();
      if (!p) return noPlan;
      if (p.host_id !== userId) return { text: `Only the host can cancel "${p.title}". I can take you out of it if you'd like.` };
      return { text: `Cancel "${p.title}"? Everyone's money goes back.`, card: confirm("Cancel the plan", { method: "POST", path: `plans/${p.id}/cancel` }) };
    }
    case "pay_booking": {
      const p = await planNamed();
      const done = p ? await (await import("../core/jar")).bookingState(d, p.id) : null;
      if (p && done && done.remainingCents === 0) return { text: `"${p.title}" is already paid for. Add the receipt when you have it.`, card: open("Add the receipt", `/plans/${p.id}?do=receipt`) };
      return p ? { text: `Let's pay for "${p.title}" from your Treat Jar.`, card: open("Pay for it", `/plans/${p.id}?do=pay`) } : noPlan;
    }
    case "answer_whim": {
      const list = await pendingAnswers(userId);
      const a = whimNamed(list);
      if (!a) {
        const n = whimNamed(await asksOfMe());
        if (n) return decideAsk(n);
        return { text: list.length ? "Which whim do you mean?" : "No whims are waiting on you. If you asked me to negotiate one, it's with the host." };
      }
      const answer = /\b(no|not|nope|can'?t)\b/i.test(args.answer ?? message) ? "no" : "yes";
      return { text: `Say ${answer} to "${a.what}"? ${a.shareText}.`, card: confirm(answer === "yes" ? "Say yes" : "Say no", { method: "POST", path: "answers/confirm", body: { items: [{ answerId: a.id, answer }] } }) };
    }
    case "negotiate_whim": {
      const list = await pendingAnswers(userId);
      const a = whimNamed(list);
      if (!a) return { text: list.length ? "Which whim do you mean?" : "No whims are waiting for you." };
      return { text: `Want me to talk to the host's kitten about "${a.what}"?`, card: confirm(`Ask ${kitten?.name ?? "me"} to negotiate`, { method: "POST", path: `whims/${a.whim_id}/negotiate`, body: { wish: args.text ?? message } }) };
    }
    case "answer_negotiation": {
      const list = await asksOfMe();
      const n = whimNamed(list);
      return n ? decideAsk(n) : { text: list.length ? "Which one do you mean?" : "Nobody's asked to change one of your whims." };
    }
    case "pounce_plan": {
      const p = await planNamed();
      if (!p) return noPlan;
      if (p.host_id !== userId) return { text: `Only the host can Pounce on "${p.title}".` };
      return { text: `Pounce on "${p.title}" with who's in? Money moves right away.`, card: confirm("Pounce", { method: "POST", path: `plans/${p.id}/pounce` }) };
    }
    case "add_receipt": {
      const p = await planNamed();
      if (!p) return noPlan;
      const booking = await (await import("../core/jar")).bookingState(d, p.id);
      if (booking && booking.remainingCents > 0) return { text: `"${p.title}" isn't paid for yet. Pay from your Treat Jar first, or tell me you paid another way.`, card: open("Pay for it", `/plans/${p.id}?do=pay`) };
      return { text: `Let's add the receipt for "${p.title}".`, card: open("Add receipt", `/plans/${p.id}?do=receipt`) };
    }
    case "confirm_answers": {
      const pending = (await pendingAnswers(userId)).filter((p) => p.prepared === "yes");
      if (!pending.length) return { text: "No answers I can send for you. The rest need you to say yes or no." };
      return { text: `I've prepared ${pending.length}: ${pending.map((p) => `${p.what} (${p.prepared})`).join(", ")}. Send them?`, card: confirm("Send my answers", { method: "POST", path: "answers/confirm", body: { items: pending.map((p) => ({ answerId: p.id })) } }) };
    }
    case "ask_for_help": {
      // A draft only: the request goes out after the owner picks friends and taps send (FR-CHAT-2).
      const amount = cents(args.dollars);
      return { text: amount ? `I drafted a request for ${fmt(amount)}: "${args.note ?? ""}". Pick who to ask, then tap send. Only they will see it.` : "How much do you need, and what for?", card: { type: "help_draft", cents: amount, note: args.note ?? "", action: { method: "POST", path: "help" }, label: "Choose who to ask", href: "/kitten/lives?ask=1" } };
    }
    case "my_party": {
      const lines = [];
      for (const s of squads.filter((x) => x.kind === "squad")) {
        const v = await partyView(userId, s.id);
        if (v.party) lines.push(`${v.party.name}: the jar has ${fmt(v.jarCents)}${v.party.goalCents ? ` of ${fmt(v.party.goalCents)}` : ""}${v.mine ? `, yours ${fmt(v.mine.balanceCents)}` : ""}`);
      }
      return { text: lines.length ? `${lines.join(". ")}.` : "No Kitty Party yet. Start one in a squad's Party tab." };
    }
    case "my_bowl": {
      const rows = await d.query<{ service: string; share_cents: number; status: string; pay_day: number | null }>(`select b.service, m.share_cents, m.status, m.pay_day from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status <> 'left' and b.status='active' order by b.service`, [userId]);
      return { text: rows.length ? rows.map((r) => `${r.service}: ${fmt(r.share_cents)} a month${r.status === "active" && r.pay_day ? `, on the ${ordinal(r.pay_day)}` : ", waiting for you to pick a day"}.`).join(" ") : "You're not in the Bowl yet. Add a subscription in a squad's Bowl tab." };
    }
    case "join_bowl": {
      const list = await d.query<{ bowl_id: string; squad_id: string; service: string }>(`select m.bowl_id, b.squad_id, b.service from bowl_members m join bowls b on b.id=m.bowl_id where m.user_id=$1 and m.status='pending' and b.status='active'`, [userId]);
      const said = (args.bowl ?? message).toLowerCase();
      const b = list.find((x) => said.includes(x.service.toLowerCase())) ?? (list.length === 1 ? list[0] : null);
      if (!b) return { text: list.length ? "Which subscription do you mean?" : "Nothing in the Bowl is waiting for you." };
      return { text: `Join ${b.service}? Pick the day and your share comes from your Treat Jar.`, card: open("Pick a day", `/squads/${b.squad_id}?tab=bowl&open=${b.bowl_id}`) };
    }
    case "save_monthly": {
      const squad = squadNamed() ?? real.find((s) => s.kind === "squad");
      const amount = cents(args.dollars);
      if (!squad) return { text: "Which squad?" };
      if (!amount) return { text: `How much a month for ${squad.name}?` };
      return { text: `Save ${fmt(amount)} a month in ${squad.name}? Pick the day and it comes from your Treat Jar.`, card: open("Start saving", `/squads/${squad.id}?tab=party&do=join&amount=${Math.round(amount / 100)}`) };
    }
    case "top_up_jar": {
      // Money moving: a confirmation card, never done from chat directly (FR-CHAT-2).
      const amount = cents(args.dollars);
      if (!amount || amount < 0) return { text: "How much should I add to your Treat Jar?" };
      // Same limit as the top-up itself, so the card never offers something that would fail.
      if (amount > 50_000) return { text: "The most I can add at once is $500. Want me to add $500?", card: confirm("Add $500", { method: "POST", path: "jar/topup", body: { cents: 50_000 } }) };
      return { text: `Top up your Treat Jar with ${fmt(amount)}? Tap to confirm.`, card: confirm(`Add ${fmt(amount)}`, { method: "POST", path: "jar/topup", body: { cents: amount } }) };
    }
    case "withdraw_jar": {
      const amount = cents(args.dollars);
      if (!amount) return { text: "How much should I send back to your PayPal?" };
      return { text: `Send ${fmt(amount)} from your Treat Jar to your PayPal?`, card: confirm(`Send ${fmt(amount)}`, { method: "POST", path: "jar/withdraw", body: { cents: amount } }) };
    }
    case "remember": {
      const fact = (args.text ?? message).trim().slice(0, 200);
      await setKittenMemory(d, userId, [...(await kittenMemory(d, userId)), fact]);
      return { text: `I'll remember that: ${fact}` };
    }
    case "ask_data": {
      try {
        return { text: await answerFromData(args.question ?? message, await factsAbout(d, userId), { name: kitten?.name ?? "your kitten", tone }) };
      } catch (e) {
        console.error(`[kitten] ask_data: ${(e as Error).message}`);
        return { text: "My head's a bit fuzzy right now. Try asking about your month, your plans or what you owe." };
      }
    }
    default:
      return { text: (args.reply ?? "Purr. I can float a whim, check your month, or ask a friend's kitten.").slice(0, 400) };
  }
}

/** Every chat turn is kept, so the pinned chat is still there when you come back. */
export async function kittenChat(userId: string, message: string): Promise<ChatReply> {
  const out = await reply(userId, message);
  await logEvent(await db(), { userId, actor: "kitten", type: "chat.reply", payload: { reply: out.text, card: out.card ?? null } });
  return out;
}

/** The kitten's chat: what you said, what it said, every card it needs you for, and everything that happened. */
export async function chatHistory(userId: string) {
  const d = await db();
  await openNeeds(userId);
  const [talk, cards, happenings] = await Promise.all([
    d.query<{ id: string; type: string; payload: { message?: string; reply?: string; card?: Record<string, unknown> | null }; created_at: string }>(
      `select id, type, payload, created_at from events where user_id=$1 and type in ('chat.message','chat.reply') order by id desc limit 80`,
      [userId],
    ),
    d.query<{ id: string; text: string; card: Record<string, unknown>; created_at: string; read_at: string | null; done_at: string | null }>(`select id, text, card, created_at, read_at, done_at from kitten_cards where user_id=$1 order by id desc limit 60`, [userId]),
    diary(d, userId, 60, CARD_EVENTS),
  ]);
  const at = (x: string) => new Date(x).getTime();
  const messages = [
    ...talk.map((r) => (r.type === "chat.message" ? { id: `e${r.id}`, ts: at(r.created_at), from: "me" as const, text: r.payload.message ?? "" } : { id: `e${r.id}`, ts: at(r.created_at), from: "kitten" as const, text: r.payload.reply ?? "", card: r.payload.card ?? undefined })),
    ...cards.map((c) => ({ id: `c${c.id}`, ts: at(c.created_at), from: "kitten" as const, text: c.text, card: c.done_at ? undefined : { ...c.card, text: c.text }, need: true, done: Boolean(c.done_at), seen: Boolean(c.read_at) })),
    ...happenings.map((e) => ({ id: `e${e.id}`, ts: at(e.createdAt), from: "kitten" as const, text: e.line, fyi: true })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .slice(-150);
  return { messages };
}

/** How many things your kitten has told you that you haven't seen yet. */
export async function kittenUnread(userId: string) {
  const d = await db();
  await openNeeds(userId);
  const [{ cards }] = await d.query<{ cards: number }>(`select count(*)::int as cards from kitten_cards where user_id=$1 and read_at is null`, [userId]);
  const [{ news }] = await d.query<{ news: number }>(
    `select count(*)::int as news from events e join kittens k on k.user_id=e.user_id where e.user_id=$1 and e.actor in ('kitten','system') and e.created_at > coalesce(k.chat_seen_at, now()) and e.type <> all($2::text[])`,
    [userId, CARD_EVENTS],
  );
  return { unread: cards + news };
}

/** "Not now": closed until something about it changes. */
export async function dismissKittenCard(userId: string, key: string) {
  await (await db()).query(`update kitten_cards set dismissed_at=now(), done_at=now(), read_at=coalesce(read_at, now()) where user_id=$1 and key=$2`, [userId, key]);
  return { ok: true };
}

/** Seen: in the kitten's chat, or anywhere else its cards show up (owner, 9 Nov). */
/** Seen on Meows: the cards there are read, but anything else the kitten told you stays unread until you open the chat. */
export async function markCardsRead(userId: string) {
  await (await db()).query(`update kitten_cards set read_at=now() where user_id=$1 and read_at is null`, [userId]);
  return { ok: true };
}

export async function markKittenRead(userId: string) {
  const d = await db();
  await d.query(`update kitten_cards set read_at=now() where user_id=$1 and read_at is null`, [userId]);
  await d.query(`update kittens set chat_seen_at=now() where user_id=$1`, [userId]);
  return { ok: true };
}

/**
 * Ask a friend's kitten (FR-KIT-5/6): it answers only what the friend shares; money is always refused;
 * when it isn't sure, it asks its owner first and answers later.
 */
export async function askFriendKitten(fromId: string, friendId: string, question: string) {
  const d = await db();
  if (!(await sharesASquad(d, fromId, friendId))) throw new Error("You can only ask friends' kittens.");
  const friend = await getUser(d, friendId);
  const share = shareable(await listRules(d, friendId));
  const tz = validTz(friend?.tz);
  const lt = localToday(tz);
  const c = await classifyQuestion(question, `${lt.weekday} ${lt.date}`);
  // `text` is their kitten talking, for the friend's chat. `relayed` is your own kitten telling you what it heard, with no
  // kitten names, so it's clear who is speaking in your kitten's chat (FR-KIT-5, owner 9 Nov).
  const heard = <S extends string>(status: S, text: string, said = text) => ({ status, text, relayed: `I asked ${friend?.name}'s kitten, and they said ${said}` });
  if (c.topic === "money") return heard("refused", "I never share anything about money.", "they never share anything about money.");

  if (c.topic === "availability" && c.date && share.availability) {
    // The friend's own day, in their time zone (Phase 1 finding: a Friday-evening plan looked like Saturday in UTC).
    const start = zonedToUtc(c.date.slice(0, 10), tz);
    const end = zonedToUtc(c.date.slice(0, 10), tz, { endOfDay: true });
    const w = start && end ? { start, end } : null;
    const cal = await calendar(d, friendId);
    const res = clash(w, cal.plansIn, cal.busy);
    const knowsUsual = Object.keys(friend?.availability ?? {}).length > 0 || cal.busy.length > 0 || cal.plansIn.length > 0;
    if (res.hard || res.soft) return heard("answered", `${friend?.name} is busy then.`);
    if (knowsUsual) return heard("answered", `${friend?.name} looks free then.`);
  }
  if (c.topic === "attendance" && c.plan && share.attendance && friend) {
    // Only plans in a squad the asker is also in, so nobody learns about plans they can't see.
    const candidates = await d.query<{ title: string; status: string; created_at: string }>(
      `select pl.title, m.status, pl.created_at from plans pl join plan_members m on m.plan_id=pl.id and m.user_id=$1
       where pl.status not in ('cancelled') and pl.squad_id in
         (select squad_id from memberships where user_id=$2 and left_at is null)
       order by pl.created_at desc limit 30`,
      [friendId, fromId],
    );
    // Match on the main words, not the exact title: "the cabin weekend" should find "Cabin trip" (owner test, 7 Nov).
    const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["the", "and", "for", "our", "trip", "plan", "night", "weekend"].includes(w));
    const asked = words(c.plan);
    const score = (title: string) => (title.toLowerCase() === c.plan!.trim().toLowerCase() ? 100 : 0) + words(title).filter((w) => asked.includes(w)).length;
    const p = candidates.map((x) => ({ ...x, s: score(x.title) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
    if (p) {
      const said = p.status === "in" ? `is in for ${p.title}` : p.status === "out" ? `isn't coming to ${p.title}` : `hasn't decided about ${p.title} yet`;
      return heard("answered", `${friend.name} ${said}.`);
    }
  }
  if (c.topic === "interests" && share.interests && friend) {
    return heard("answered", `${friend.name} is into ${friend.interests.join(", ")}.`);
  }
  // Not sure → ask the owner in their kitten chat (FR-KIT-5).
  const [asker] = await d.query<{ name: string }>(`select name from users where id=$1`, [fromId]);
  await logEvent(d, {
    userId: friendId,
    actor: "kitten",
    type: "kitten.ask_owner",
    payload: { fromId, fromName: asker?.name, question, text: `${asker?.name}'s kitten asked: "${question}". What should I say?` },
    reason: "I wasn't sure, so I'm checking with you first",
  });
  return heard("asked_owner", `I'm not sure. I'll check with ${friend?.name} and get back to you.`, `they're not sure. They'll check with ${friend?.name} and get back to you.`);
}

const ASK_EXPIRES_MS = 72 * 3_600_000;

/** The owner answers their kitten's question, once (FR-REMIND-6); the reply reaches the asker's Meows and diary. */
export async function answerOwnerAsk(ownerId: string, eventId: number, answer: string) {
  return withLock(`ask:${eventId}`, () => answerOwnerAskNow(ownerId, eventId, answer));
}

async function answerOwnerAskNow(ownerId: string, eventId: number, answer: string) {
  const d = await db();
  const [e] = await d.query<{ user_id: string; payload: { fromId: string; fromName?: string; question: string }; created_at: string }>(`select user_id, payload, created_at from events where id=$1 and type='kitten.ask_owner'`, [eventId]);
  if (!e || e.user_id !== ownerId) throw new Error("Not your kitten's question.");
  if (Date.now() - new Date(e.created_at).getTime() > ASK_EXPIRES_MS) throw new Error("That question has expired.");
  const done = await d.query(`select 1 from events where user_id=$1 and type='kitten.owner_answered' and payload->>'askEventId'=$2 limit 1`, [ownerId, String(eventId)]);
  if (done.length) throw new Error("You already answered that one.");
  if (/\$\d|budget|balance|owe/i.test(answer)) throw new Error("Kittens never pass on money details.");
  const owner = await getUser(d, ownerId);
  const said = /^yes$/i.test(answer.trim()) ? `${owner?.name} says yes.` : /^no$/i.test(answer.trim()) ? `${owner?.name} says no.` : answer.slice(0, 200);
  await d.tx(async (q) => {
    await q.query(`insert into direct_messages (from_user, to_user, from_kind, to_kind, text) values ($1,$2,'kitten','person',$3)`, [ownerId, e.payload.fromId, said]);
    await logEvent(q, { userId: e.payload.fromId, actor: "kitten", type: "kitten.friend_reply", payload: { question: e.payload.question, text: `I asked ${owner?.name}'s kitten, and they said: ${said}` }, reason: "the friend answered their kitten" });
    await logEvent(q, { userId: ownerId, actor: "user", actorId: ownerId, type: "kitten.owner_answered", payload: { askEventId: String(eventId), text: `You answered ${e.payload.fromName ?? "a friend"}'s kitten.` }, reason: "you answered your kitten's question" });
  });
  return { ok: true };
}
