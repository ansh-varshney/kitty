"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, refreshAll, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { Btn, Chip, Icon } from "@/components/app/ui";
import { NeedCard, type Item } from "@/components/app/items";

/** One friend's chat (PRD §B18): you, your kitten, your friend and their kitten, in one place. */

type Look = Record<string, unknown> | null;
type Msg = { id: string; side: "me" | "them"; who: "person" | "kitten"; to: "person" | "kitten"; text: string };
type Thread = { friend: { id: string; name: string; kittenName: string; look: Look }; me: { kittenName: string; look: Look }; messages: Msg[]; cards: Item[] };
type Mode = "person" | "ask_kitten" | "my_kitten";

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useData<Thread>(`friends/${id}/thread`);
  const { toast } = useMoments();
  const [mode, setMode] = useState<Mode>("person");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState<(Msg & { base: string })[]>([]);
  const list = useRef<HTMLDivElement>(null);

  const lastSaved = data?.messages.at(-1)?.id ?? "";
  const messages = [...(data?.messages ?? []), ...local.filter((m) => m.base === lastSaved)];
  const friend = data?.friend;
  const me = data?.me;

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length, busy, data?.cards.length]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setText("");
    setBusy(true);
    setLocal((l) => [...l, { id: `local${Date.now()}`, base: lastSaved, side: "me", who: mode === "my_kitten" ? "kitten" : "person", to: mode === "ask_kitten" ? "kitten" : "person", text: message }]);
    try {
      await api("POST", `friends/${id}/messages`, { text: message, mode });
    } catch (e) {
      setText(message);
      toast((e as Error).message || "That didn't send. Try again.");
    }
    setBusy(false);
    refreshAll();
  };

  const nudge = async () => {
    try {
      const r = await api<{ text: string }>("POST", `friends/${id}/nudge`);
      toast(r.text);
      refreshAll();
    } catch {
      toast("That didn't work. Try again.");
    }
  };

  if (error) return <p className="p-8 text-center text-[15px]">{error.message}</p>;

  const placeholder = !friend ? "" : mode === "person" ? `Message ${friend.name}` : mode === "ask_kitten" ? `Ask ${friend.kittenName}` : `What should ${me?.kittenName} tell ${friend.name}?`;

  return (
    <div className="absolute inset-0 flex flex-col bg-paper">
      <header className="relative z-10 flex shrink-0 items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]" style={{ backgroundImage: "url(/sky/clear.svg)", backgroundSize: "cover" }}>
        <Link href="/squads" aria-label="Back" className="press p-1">
          <Icon i="back" size={26} />
        </Link>
        <LiveKitten look={friend?.look ?? undefined} view="bust" size={60} mood={busy && mode === "ask_kitten" ? "thinking" : "neutral"} title={friend?.kittenName} tappable={false} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-serif text-[22px] font-bold leading-6">{friend?.name ?? "..."}</p>
          <p className="truncate text-[13px] text-soft">{busy && mode === "ask_kitten" ? `${friend?.kittenName} is thinking...` : `and ${friend?.kittenName ?? "their kitten"}, their kitten`}</p>
        </div>
        <button type="button" onClick={() => void nudge()} className="press shrink-0 rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold shadow-[0_2px_0_var(--color-line)]">
          Nudge
        </button>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-4 no-scrollbar">
        {data && !messages.length && (
          <div className="pop-in px-2 py-6 text-center">
            <p className="font-serif text-[22px] font-bold">Say hi to {friend?.name}.</p>
            <p className="mt-1 text-[15px] text-soft">Or ask {friend?.kittenName} if {friend?.name} is free. {me?.kittenName} can pass on a message for you too.</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.side === "me";
          const kitten = m.who === "kitten";
          const name = mine ? (kitten ? me?.kittenName : null) : kitten ? friend?.kittenName : friend?.name;
          const face = kitten ? (
            <LiveKitten look={(mine ? me?.look : friend?.look) ?? undefined} view="head" size={32} tappable={false} className="shrink-0" />
          ) : !mine ? (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-inset text-[13px] font-extrabold">{friend?.name[0]?.toUpperCase()}</span>
          ) : null;
          return (
            <div key={m.id} className={`pop-in flex items-end gap-1.5 ${mine ? "flex-row-reverse" : ""}`}>
              {face}
              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-md bg-honey-soft" : "rounded-bl-md bg-card shadow-[0_2px_0_var(--color-line)]"}`}>
                {(name || (mine && m.to === "kitten")) && (
                  <p className="text-[12px] font-extrabold text-soft">
                    {name}
                    {mine && m.to === "kitten" ? `${name ? " " : ""}to ${friend?.kittenName}` : ""}
                  </p>
                )}
                <p className="text-[15px] leading-[21px]">{m.text}</p>
              </div>
            </div>
          );
        })}
        {data?.cards.map((c) => (
          <NeedCard key={c.key} item={c} />
        ))}
      </div>

      <div className="shrink-0 bg-paper px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          <Chip on={mode === "person"} onClick={() => setMode("person")}>
            {friend?.name ?? "Friend"}
          </Chip>
          <Chip on={mode === "ask_kitten"} onClick={() => setMode("ask_kitten")}>
            Ask {friend?.kittenName ?? "their kitten"}
          </Chip>
          <Chip on={mode === "my_kitten"} onClick={() => setMode("my_kitten")}>
            {me?.kittenName ?? "My kitten"} tells them
          </Chip>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 rounded-2xl bg-card px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-honey)]" />
          <Btn small type="submit" disabled={!text.trim() || busy} aria-label="Send" className="!px-4">
            <Icon i="send" size={20} />
          </Btn>
        </form>
      </div>
    </div>
  );
}
