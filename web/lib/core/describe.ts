import type { Queryable } from "../db";

/**
 * One plain sentence for anything that happened (PRD §B19): what it was about, how much, and to or from whom.
 * The Kitten Diary, the kitten's chat, the exports and the kitten's own answers all read these same sentences.
 */

export type DescribeRow = { type: string; payload: Record<string, unknown>; objectType: string | null; objectId: string | null; squadId: string | null };

/** Events that arrive as a card to act on, so the kitten's chat shows the card instead of saying it twice. */
export const CARD_EVENTS = ["answer.prepared", "yarn.confirm", "yarn.disputed", "yarn.pay", "kitten.ask_owner", "help.asked", "bowl.invite", "catnip.invite", "pawup.asked", "help.progress", "party.payment_failed", "bowl.payment_failed", "chat.message", "chat.reply", "chat.dm"];

const money = (c: unknown) => `$${(Number(c) / 100).toFixed(2)}`;
const isId = (s: string | null) => Boolean(s && /^[0-9a-f-]{36}$/i.test(s));
const cost = (price: number | null, mode: string | null, upTo: number | null) => (price ? `${money(price)} ${mode === "per_person" ? "each" : "in total"}` : upTo ? `about ${money(upTo)} each` : "no price yet");

export async function describeAll(q: Queryable, userId: string, rows: DescribeRow[]): Promise<string[]> {
  const ofType = (t: string) => [...new Set(rows.filter((r) => r.objectType === t && isId(r.objectId)).map((r) => r.objectId!))];
  const planIds = ofType("plan");
  const whimIds = ofType("whim");
  const cardIds = ofType("yarn");
  const squadIds = [...new Set(rows.map((r) => r.squadId).filter((s): s is string => isId(s)))];
  const personIds = [...new Set(rows.map((r) => r.payload.forUser as string | undefined).filter((s): s is string => Boolean(s && isId(s))))];

  const [plans, whims, cards, squads, people, [me]] = await Promise.all([
    planIds.length ? q.query<{ id: string; title: string; price_cents: number; price_mode: string }>(`select id, title, price_cents, price_mode from plans where id = any($1::uuid[])`, [planIds]) : [],
    whimIds.length ? q.query<{ id: string; what: string; when_text: string | null; starts_at: string | null; price_cents: number | null; up_to_cents: number | null; price_mode: string | null; need_at_least: number }>(`select id, what, when_text, starts_at, price_cents, up_to_cents, price_mode, need_at_least from whims where id = any($1::uuid[])`, [whimIds]) : [],
    cardIds.length ? q.query<{ id: string; note: string; cents: number }>(`select id, note, cents from yarn_cards where id = any($1::uuid[])`, [cardIds]) : [],
    squadIds.length ? q.query<{ id: string; name: string }>(`select id, name from squads where id = any($1::uuid[])`, [squadIds]) : [],
    personIds.length ? q.query<{ id: string; name: string }>(`select id, name from users where id = any($1::uuid[])`, [personIds]) : [],
    q.query<{ tz: string }>(`select tz from users where id=$1`, [userId]),
  ]);
  const tz = me?.tz ?? "UTC";
  const planOf = new Map(plans.map((p) => [p.id, p]));
  const whimOf = new Map(whims.map((w) => [w.id, w]));
  const cardOf = new Map(cards.map((c) => [c.id, c]));
  const squadOf = new Map(squads.map((s) => [s.id, s.name]));
  const personOf = new Map(people.map((p) => [p.id, p.name]));
  const when = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz });

  return rows.map((e) => {
    const p = e.payload as Record<string, unknown> & { text?: string; cents?: number; what?: string; message?: string; reply?: string };
    const plan = e.objectId ? planOf.get(e.objectId) : undefined;
    const whim = e.objectId ? whimOf.get(e.objectId) : undefined;
    const card = e.objectId ? cardOf.get(e.objectId) : undefined;
    const squad = e.squadId ? squadOf.get(e.squadId) : undefined;
    const inSquad = squad ? ` in ${squad}` : "";
    const title = plan ? `"${plan.title}"` : "a plan";
    const whimAbout = whim ? [`"${whim.what}"`, whim.starts_at ? when(whim.starts_at) : whim.when_text, cost(whim.price_cents, whim.price_mode, whim.up_to_cents)].filter(Boolean).join(", ") : `"${p.what ?? "a whim"}"`;

    switch (e.type) {
      case "chat.message":
        return `You said: ${p.message ?? ""}`;
      case "chat.reply":
        return `I said: ${p.reply ?? ""}`;
      case "whim.floated":
        return `You floated a whim${squad ? ` to ${squad}` : ""}: ${whimAbout}. It needs ${whim?.need_at_least ?? p.needAtLeast ?? 2} people to say yes.`;
      case "answer.prepared":
        return `A friend floated ${whimAbout}${inSquad}. I suggested ${p.prepared}: ${p.reason ?? "it looked right for you"}.`;
      case "answer.confirmed":
        return `You answered ${p.answer} to ${whimAbout}.`;
      case "plan.created":
        return `${plan ? title : `"${p.title}"`} became a plan${inSquad}${plan ? `: ${cost(plan.price_cents, plan.price_mode, null)}` : ""}. Enough friends said yes.`;
      case "plan.rechecked":
        return `${title} changed, so I checked it again and now suggest ${p.answer}: ${p.reason ?? "things moved"}.`;
      case "plan.suggestion":
        return `A friend suggested a change to ${title}: ${Object.keys((p.changes as object) ?? {}).join(", ") || "the details"}.`;
      case "paw.deferred":
        return `${title}: you're in, up to ${money(p.limitCents)}. I'll place the hold closer to the deadline.`;
      case "paw.approved":
        return `${title}: you approved a PayPal hold of ${money(p.cents)}.`;
      case "paw.up":
        return `${title}: you pawed up by ${money(p.cents)}, from ${p.source === "jar" ? "your Treat Jar" : p.source === "savings" ? "your savings" : "PayPal"}.`;
      case "paw.cover":
        return `${title}: you covered ${money(p.cents)} for ${personOf.get(p.forUser as string) ?? "a friend"}, from ${p.source === "jar" ? "your Treat Jar" : "PayPal"}.`;
      case "jar.topped_up":
        return `${money(p.cents)} went into your Treat Jar from PayPal.`;
      case "jar.withdrawn":
        return `${money(p.cents)} went from your Treat Jar back to your PayPal.`;
      case "tag_along.paid":
        if (p.text) break;
        return `${title}: you tagged along and paid ${money(p.cents)}.`;
      case "kitten.adopted":
        return `You adopted ${p.kitten}.`;
      case "rule.added":
        return `New House Rule: ${p.plain}.`;
    }
    if (p.text) {
      // A line that doesn't say which plan or card it's about gets that added.
      if (plan && !p.text.includes(plan.title)) return `${title}: ${p.text}`;
      if (card && !p.text.includes(card.note)) return `${p.text} (${card.note}, ${money(card.cents)})`;
      return p.text;
    }
    const words = e.type.replace(/[._]/g, " ");
    const about = plan ? `: ${title}` : whim ? `: ${whimAbout}` : card ? `: ${card.note}` : "";
    return `${words[0].toUpperCase()}${words.slice(1)}${about}${p.cents != null ? `, ${money(p.cents)}` : ""}${inSquad}.`;
  });
}
