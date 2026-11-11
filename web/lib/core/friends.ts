import { db } from "../db";
import { logEvent } from "./events";
import { getKitten, getUser, sharesASquad } from "./users";
import { askFriendKitten } from "../kitten/chat";
import { kittenSays } from "../kitten/ai";
import { PERSONALITIES } from "../kitten/looks";
import { openNeeds } from "./meows";

/**
 * One-to-one chats (PRD §B18, FR-CHAT-8..10). Each friend has one thread holding four voices: you, your kitten, your
 * friend and their kitten. Only people who share a squad can talk here.
 */

type Row = { id: string; from_user: string; to_user: string; from_kind: "person" | "kitten"; to_kind: "person" | "kitten"; text: string; created_at: string };

export type ThreadMessage = { id: string; at: string; side: "me" | "them"; who: "person" | "kitten"; to: "person" | "kitten"; text: string };

/** Everyone you share a squad with, most recent conversation first. */
export async function friendsList(userId: string) {
  const d = await db();
  const people = await d.query<{ id: string; name: string; kitten_name: string | null; kitten_look: Record<string, unknown> | null }>(
    `select distinct u.id, u.name, k.name as kitten_name, k.look as kitten_look
     from memberships a join memberships b on a.squad_id=b.squad_id join users u on u.id=b.user_id left join kittens k on k.user_id=u.id
     where a.user_id=$1 and b.user_id<>$1 and a.left_at is null and b.left_at is null`,
    [userId],
  );
  const rows = await Promise.all(
    people.map(async (p) => {
      const [last] = await d.query<Row>(`select * from direct_messages where (from_user=$1 and to_user=$2) or (from_user=$2 and to_user=$1) order by id desc limit 1`, [userId, p.id]);
      const [{ n }] = await d.query<{ n: number }>(`select count(*)::int as n from direct_messages where from_user=$2 and to_user=$1 and to_kind='person' and read_at is null`, [userId, p.id]);
      return { id: p.id, name: p.name, kittenName: p.kitten_name, look: p.kitten_look, lastText: last?.text ?? null, lastAt: last?.created_at ?? null, unread: n };
    }),
  );
  return rows.sort((a, b) => (b.lastAt ? new Date(b.lastAt).getTime() : 0) - (a.lastAt ? new Date(a.lastAt).getTime() : 0) || a.name.localeCompare(b.name));
}

async function mustBeFriends(userId: string, friendId: string) {
  if (userId === friendId || !(await sharesASquad(await db(), userId, friendId))) throw new Error("You can only message friends in your squads.");
}

/** The thread: messages between the two of you and your kittens, plus the reminders your kittens sent each other. */
export async function thread(userId: string, friendId: string) {
  await mustBeFriends(userId, friendId);
  const d = await db();
  const [friend, friendKitten, myKitten] = await Promise.all([getUser(d, friendId), getKitten(d, friendId), getKitten(d, userId)]);
  const dms = await d.query<Row>(`select * from direct_messages where (from_user=$1 and to_user=$2) or (from_user=$2 and to_user=$1) order by id desc limit 200`, [userId, friendId]);
  const nudges = await d.query<{ id: string; text: string; from_user: string; sent_at: string }>(
    `select id, text, from_user, sent_at from reminders where text <> '' and ((from_user=$1 and user_id=$2) or (from_user=$2 and user_id=$1)) order by sent_at desc limit 40`,
    [userId, friendId],
  );
  await d.query(`update direct_messages set read_at=now() where from_user=$2 and to_user=$1 and read_at is null`, [userId, friendId]);
  const messages: ThreadMessage[] = [
    ...dms.reverse().map((m) => ({ id: `dm${m.id}`, at: m.created_at, side: m.from_user === userId ? ("me" as const) : ("them" as const), who: m.from_kind, to: m.to_kind, text: m.text })),
    ...nudges.map((r) => ({ id: `nudge${r.id}`, at: r.sent_at, side: r.from_user === userId ? ("me" as const) : ("them" as const), who: "kitten" as const, to: "kitten" as const, text: r.text })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return {
    friend: { id: friendId, name: friend?.name ?? "Your friend", kittenName: friendKitten?.name ?? "their kitten", look: friendKitten?.look ?? null },
    me: { kittenName: myKitten?.name ?? "Your kitten", look: myKitten?.look ?? null },
    messages,
    cards: (await openNeeds(userId)).filter((n) => n.withFriend === friendId),
  };
}

async function save(from: string, to: string, fromKind: "person" | "kitten", toKind: "person" | "kitten", text: string) {
  await (await db()).query(`insert into direct_messages (from_user, to_user, from_kind, to_kind, text) values ($1,$2,$3,$4,$5)`, [from, to, fromKind, toKind, text]);
}

export type SendMode = "person" | "ask_kitten" | "my_kitten";

/** Say something: you to your friend, you to their kitten, or your kitten to your friend on your behalf. */
export async function sendToFriend(userId: string, friendId: string, input: { text: string; mode: SendMode }) {
  await mustBeFriends(userId, friendId);
  const d = await db();
  const text = input.text.trim();
  if (input.mode === "ask_kitten") {
    await save(userId, friendId, "person", "kitten", text);
    const r = await askFriendKitten(userId, friendId, text);
    await save(friendId, userId, "kitten", "person", r.text);
    return { status: r.status };
  }
  if (input.mode === "my_kitten") {
    const [kitten, friend] = await Promise.all([getKitten(d, userId), getUser(d, friendId)]);
    const tone = PERSONALITIES.find((p) => p.breed === kitten?.breed)?.label.toLowerCase() ?? "friendly";
    await save(userId, friendId, "kitten", "person", await kittenSays(text, { name: kitten?.name ?? "A kitten", tone, friend: friend?.name ?? "your friend" }));
  } else {
    await save(userId, friendId, "person", "person", text);
  }
  // The friend's screen refreshes, and their Squads tab shows the unread count. The words stay out of the event log.
  await logEvent(d, { userId: friendId, actor: "user", actorId: userId, type: "chat.dm", payload: { fromId: userId } });
  return { status: "sent" as const };
}
