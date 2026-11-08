import { db } from "../db";
import { explainTerm } from "./glossary";
import { diary, logEvent } from "../core/events";
import { getKitten, getUser, listRules, mySquads, sharesASquad, addCustomRule } from "../core/users";
import { calendar, committedCents, jarBalances, monthSpentCents } from "../core/month";
import { createWhim } from "../core/whims";
import { logIPaid, myYarn, runUntangle } from "../core/yarn";
import { partyView } from "../core/party";
import { chatIntent, classifyQuestion } from "./ai";
import { funBudgetCents, shareable } from "../referee/rules";
import { clash, localToday, validTz, zonedToUtc } from "../referee/time";

/** Talking to your kitten, and to a friend's kitten (PRD §B2 "A friend's kitten", §B18, FR-CHAT-*, FR-KIT-5/6). */

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

export type ChatReply = { text: string; card?: Record<string, unknown> };

export async function kittenChat(userId: string, message: string): Promise<ChatReply> {
  const d = await db();
  const squads = await mySquads(d, userId);
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
  const { tool, args } = await chatIntent(message, friends.map((f) => f.name));
  await logEvent(d, { userId, actor: "user", actorId: userId, type: "chat.message", payload: { message, tool } });
  switch (tool) {
    case "create_whim": {
      const squad = squads.find((s) => s.kind === "squad");
      if (!squad) return { text: "Which squad is this for? Make one first." };
      const w = await createWhim(userId, { squadId: squad.id, text: args.text ?? message });
      return { text: `Floated "${w.what}" to ${squad.name}. I'll tell you when enough friends are in.`, card: { type: "whim", ...w } };
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
      const friend = friends.find((f) => f.name.toLowerCase() === (args.friend ?? "").toLowerCase());
      if (!friend) return { text: "Which friend? I can only ask kittens of friends in your squads." };
      const res = await askFriendKitten(userId, friend.id, args.question ?? message);
      return { text: res.text, card: { type: "friend_answer", ...res } };
    }
    case "explain": {
      const [last] = (await diary(d, userId, 20)).filter((e) => e.actor === "kitten");
      return { text: last ? `Last thing I did: ${last.type.replace(".", " ")}. Why: ${last.reason ?? "you asked me to"}.` : "I haven't done anything on my own yet." };
    }
    case "log_i_paid": {
      // Not money moving: it creates a card each friend confirms (FR-YARN-2).
      const cents = Math.round(Number(String(args.dollars ?? "").replace(/[^0-9.]/g, "")) * 100);
      const names = String(args.friends ?? "").split(/,|\band\b/).map((x) => x.trim().toLowerCase()).filter(Boolean);
      const people = friends.filter((f) => names.includes(f.name.toLowerCase()));
      const squad = squads.find((s) => s.kind === "squad");
      if (!cents || !people.length || !squad) return { text: "Tell me the amount and who it was for, like \"I paid $48 for dinner for Jordan and Tyler\"." };
      // "for coffee for Ava and Tyler": if the model left the note out, take it from the words themselves.
      const note = (args.note?.trim() || /\bfor\s+(.+?)\s+for\b/i.exec(message)?.[1] || "something").slice(0, 60);
      const r = await logIPaid(userId, { squadId: squad.id, cents, note, forUserIds: people.map((p) => p.id) });
      return { text: `Logged it: you paid ${fmt(cents)} for ${note}. ${people.map((p) => p.name).join(" and ")} will confirm with one tap.`, card: { type: "yarn_card", ...r } };
    }
    case "my_yarn": {
      const y = await myYarn(userId);
      const owe = y.reduce((a, s) => a + s.youOweCents, 0);
      const owed = y.reduce((a, s) => a + s.owedToYouCents, 0);
      const why = y.flatMap((s) => s.strands).slice(0, 3).map((s) => s.text).join(" ");
      return { text: owe || owed ? `You owe ${fmt(owe)}, and friends owe you ${fmt(owed)}.${why ? ` ${why}` : ""}` : "All untangled. Nobody owes anybody.", card: { type: "yarn", squads: y } };
    }
    case "untangle": {
      const squad = squads.find((s) => s.kind === "squad");
      if (!squad) return { text: "Join a squad first." };
      const r = await runUntangle(userId, squad.id);
      const mine = r.transfers.filter((t) => t.from === userId);
      return { text: r.transfers.length ? `Untangled ${squad.name} into ${r.transfers.length} payment${r.transfers.length > 1 ? "s" : ""}.${mine.length ? ` Yours: ${fmt(mine.reduce((a, t) => a + t.cents, 0))}. Tap to pay.` : " Nothing for you to pay."}` : `${squad.name} is all untangled.`, card: { type: "untangle", ...r } };
    }
    case "ask_for_help": {
      // A draft only: the request goes out after the owner picks friends and taps send (FR-CHAT-2).
      const cents = Math.round(Number(String(args.dollars ?? "").replace(/[^0-9.]/g, "")) * 100);
      return { text: cents ? `I drafted a request for ${fmt(cents)}: "${args.note ?? ""}". Pick who to ask, then tap send. Only they will see it.` : "How much do you need, and what for?", card: { type: "help_draft", cents, note: args.note ?? "", action: { method: "POST", path: "help" } } };
    }
    case "my_party": {
      const lines = [];
      for (const s of squads.filter((x) => x.kind === "squad")) {
        const v = await partyView(userId, s.id);
        if (v.party) lines.push(`${v.party.name}: the jar has ${fmt(v.jarCents)}${v.party.goalCents ? ` of ${fmt(v.party.goalCents)}` : ""}${v.mine ? `, yours ${fmt(v.mine.balanceCents)}` : ""}`);
      }
      return { text: lines.length ? `${lines.join(". ")}.` : "No Kitty Party yet. Start one in a squad's Party tab." };
    }
    case "top_up_jar": {
      // Money moving: a confirmation card, never done from chat directly (FR-CHAT-2).
      const cents = Math.round(Number(String(args.dollars ?? "").replace(/[^0-9.]/g, "")) * 100);
      if (!cents || cents < 0) return { text: "How much should I add to your Treat Jar?" };
      // Same limit as the top-up itself, so the card never offers something that would fail.
      if (cents > 50_000) return { text: "The most I can add at once is $500. Want me to add $500?", card: { type: "confirm", action: { method: "POST", path: "jar/topup", body: { cents: 50_000 } } } };
      return { text: `Top up your Treat Jar with ${fmt(cents)}? Tap to confirm.`, card: { type: "confirm", action: { method: "POST", path: "jar/topup", body: { cents } } } };
    }
    default:
      return { text: (args.reply ?? "Purr. I can float a whim, check your month, or ask a friend's kitten.").slice(0, 300) };
  }
}

/**
 * Ask a friend's kitten (FR-KIT-5/6): it answers only what the friend shares; money is always refused;
 * when it isn't sure, it asks its owner first and answers later.
 */
export async function askFriendKitten(fromId: string, friendId: string, question: string) {
  const d = await db();
  if (!(await sharesASquad(d, fromId, friendId))) throw new Error("You can only ask friends' kittens.");
  const friend = await getUser(d, friendId);
  const kitten = await getKitten(d, friendId);
  const share = shareable(await listRules(d, friendId));
  const tz = validTz(friend?.tz);
  const lt = localToday(tz);
  const c = await classifyQuestion(question, `${lt.weekday} ${lt.date}`);
  const name = kitten?.name ?? "Their kitten";
  if (c.topic === "money") return { status: "refused" as const, text: `${name}: I never share anything about money.` };

  if (c.topic === "availability" && c.date && share.availability) {
    // The friend's own day, in their time zone (Phase 1 finding: a Friday-evening plan looked like Saturday in UTC).
    const start = zonedToUtc(c.date.slice(0, 10), tz);
    const end = zonedToUtc(c.date.slice(0, 10), tz, { endOfDay: true });
    const w = start && end ? { start, end } : null;
    const cal = await calendar(d, friendId);
    const res = clash(w, cal.plansIn, cal.busy);
    const knowsUsual = Object.keys(friend?.availability ?? {}).length > 0 || cal.busy.length > 0 || cal.plansIn.length > 0;
    if (res.hard || res.soft) return { status: "answered" as const, text: `${name}: ${friend?.name} is busy then.` };
    if (knowsUsual) return { status: "answered" as const, text: `${name}: ${friend?.name} looks free then.` };
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
      return { status: "answered" as const, text: `${name}: ${friend.name} ${said}.` };
    }
  }
  if (c.topic === "interests" && share.interests && friend) {
    return { status: "answered" as const, text: `${name}: ${friend.name} is into ${friend.interests.join(", ")}.` };
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
  return { status: "asked_owner" as const, text: `${name}: I'm not sure. I'll check with ${friend?.name} and get back to you.` };
}

/** The owner answers their kitten's question; the asker gets the reply in their diary. */
export async function answerOwnerAsk(ownerId: string, eventId: number, answer: string) {
  const d = await db();
  const [e] = await d.query<{ user_id: string; payload: { fromId: string; question: string } }>(`select user_id, payload from events where id=$1 and type='kitten.ask_owner'`, [eventId]);
  if (!e || e.user_id !== ownerId) throw new Error("Not your kitten's question.");
  if (/\$\d|budget|balance|owe/i.test(answer)) throw new Error("Kittens never pass on money details.");
  const kitten = await getKitten(d, ownerId);
  await logEvent(d, { userId: e.payload.fromId, actor: "kitten", type: "kitten.friend_reply", payload: { question: e.payload.question, text: `${kitten?.name}: ${answer.slice(0, 200)}` }, reason: "the friend answered their kitten" });
  return { ok: true };
}
