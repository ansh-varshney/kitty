"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, refreshAll, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { NeedButtons, SeeCard, runAction, type Action, type Item } from "@/components/app/items";
import { Btn, Icon } from "@/components/app/ui";
import { WhimSheet } from "@/components/app/plus";

/**
 * Your kitten's chat (PRD §B18): the manager of everything. What it needs from you lands here first as a card, what
 * happened is told here, and you can ask it anything or tell it what to do.
 */

type Card = Partial<Item> & { type?: string; label?: string; href?: string; text?: string; squadId?: string | null; action?: Action; options?: { label: string; action: Action }[]; plans?: { id: string; title: string }[] };
type Msg = { id: string; from: "me" | "kitten"; text: string; card?: Card; need?: boolean; done?: boolean; seen?: boolean; fyi?: boolean };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

const QUICK = ["What do I owe?", "How's my month?", "What did you do this week?", "Float a whim"];

export default function Page() {
  const router = useRouter();
  const { data: me } = useData<Me>("me");
  const { data } = useData<{ messages: Msg[] }>("kitten/history");
  const { act, toast } = useMoments();
  const tools = { router, act, toast };
  // What's on screen before the server has it. Each one goes away as soon as the saved history moves on, so nothing shows twice.
  const [local, setLocal] = useState<(Msg & { base: string })[]>([]);
  const [whim, setWhim] = useState<Card | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const k = me?.kitten;
  const lastSaved = data?.messages.at(-1)?.id ?? "";
  const messages = [...(data?.messages ?? []), ...local.filter((m) => m.base === lastSaved)];
  const saved = useRef(lastSaved);
  const list = useRef<HTMLDivElement>(null);
  const lastMine = messages.findLastIndex((m) => m.from === "me");
  // Only the newest question can be answered: an old "Float it" must never fire twice. Cards from the kitten stay live until dealt with.
  const liveId = messages.slice(lastMine + 1).find((m) => m.card && !m.need)?.id;

  useEffect(() => {
    saved.current = lastSaved;
    // You're looking at it, so it's read, here and on the Squads list.
    if (lastSaved) void api("POST", "kitten/read").catch(() => undefined);
  }, [lastSaved]);

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages.length, busy]);

  const send = async (raw: string) => {
    const message = raw.trim();
    if (!message || busy) return;
    setText("");
    setBusy(true);
    const stamp = `local${messages.length}`;
    setLocal([{ id: stamp, base: saved.current, from: "me", text: message }]);
    try {
      const r = await api<{ text: string; card?: Card }>("POST", "kitten/chat", { message });
      setLocal((l) => [...l.filter((m) => m.base === saved.current), { id: `${stamp}r`, base: saved.current, from: "kitten", text: r.text, card: r.card }]);
    } catch {
      setLocal((l) => [...l, { id: `${stamp}r`, base: saved.current, from: "kitten", text: "My head's a bit fuzzy. Try that again?" }]);
    }
    setBusy(false);
    refreshAll();
  };

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="relative z-10 flex shrink-0 items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]" style={{ backgroundImage: "url(/sky/clear.svg)", backgroundSize: "cover" }}>
        <Link href="/squads" aria-label="Back" className="press p-1">
          <Icon i="back" size={26} />
        </Link>
        <LiveKitten look={k?.look} view="bust" size={64} mood={busy ? "thinking" : "neutral"} title={k?.name} />
        <div>
          <p className="font-serif text-[22px] font-bold leading-6">{k?.name ?? "Your kitten"}</p>
          <p className="text-[13px] text-soft">{busy ? "Thinking..." : "Ask me anything, or tell me what to do."}</p>
        </div>
      </header>

      <div ref={list} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto bg-paper px-3 py-4 no-scrollbar">
        {data && !messages.length && (
          <div className="pop-in px-2 py-6 text-center">
            <p className="font-serif text-[22px] font-bold">Hi! I&apos;m {k?.name}.</p>
            <p className="mt-1 text-[15px] text-soft">I know your plans, your money and your squads. Ask me anything, or tell me what to do.</p>
          </div>
        )}
        {messages.map((m) =>
          m.from === "me" ? (
            <div key={m.id} className="pop-in flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-md bg-honey-soft px-3.5 py-2.5 text-[15px] leading-[21px]">{m.text}</p>
            </div>
          ) : m.fyi ? (
            <div key={m.id} className="pop-in flex items-end gap-1.5">
              <LiveKitten look={k?.look} view="head" size={34} tappable={false} className="shrink-0" />
              <p className="max-w-[82%] rounded-2xl rounded-bl-md bg-inset px-3.5 py-2 text-[14px] leading-[20px]">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="pop-in flex items-end gap-1.5">
              <LiveKitten look={k?.look} view="head" size={34} tappable={false} className="shrink-0" />
              <div className="max-w-[82%]">
                <p className={`rounded-2xl rounded-bl-md px-3.5 py-2.5 text-[15px] leading-[21px] shadow-[0_2px_0_var(--color-line)] ${m.need && !m.done ? "bg-honey-soft" : "bg-card"}`}>{m.text}</p>
                {m.need && m.done && <p className="mt-1 text-[12px] font-bold text-soft">Done</p>}
                {m.need && !m.done && m.card && (
                  <div className="mt-1.5">
                    {m.card.card && <SeeCard id={m.card.card.id} />}
                    <NeedButtons item={m.card as Item} />
                    {m.seen && <p className="mt-1 text-[12px] font-bold text-soft">Seen</p>}
                  </div>
                )}
                {!m.need && m.card && <ChatCard card={m.card} tools={tools} live={m.id === liveId} onWhim={setWhim} />}
              </div>
            </div>
          ),
        )}
        {busy && (
          <div className="pop-in flex items-end gap-1.5">
            <LiveKitten look={k?.look} view="head" size={34} mood="thinking" tappable={false} />
            <p className="typing rounded-2xl bg-card px-4 py-3.5">
              <span />
              <span />
              <span />
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 bg-paper px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {QUICK.map((q) => (
            <button key={q} type="button" onClick={() => void send(q)} className="press shrink-0 rounded-full bg-card px-3 py-1.5 text-[13px] font-bold shadow-[inset_0_0_0_1.5px_var(--color-line)]">
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={`Message ${k?.name ?? "your kitten"}`} className="min-w-0 flex-1 rounded-2xl bg-card px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-honey)]" />
          <Btn small type="submit" disabled={!text.trim() || busy} aria-label="Send" className="!px-4">
            <Icon i="send" size={20} />
          </Btn>
        </form>
      </div>
      {whim && <WhimSheet initialText={whim.text} squadId={whim.squadId ?? undefined} onClose={() => setWhim(null)} />}
    </div>
  );
}

function ChatCard({ card, tools, live, onWhim }: { card: Card; tools: Parameters<typeof runAction>[1]; live: boolean; onWhim: (c: Card) => void }) {
  const [gone, setGone] = useState(false);
  if (gone || (!live && ["confirm", "choices", "whim"].includes(card.type ?? ""))) return null;
  if (card.type === "whim")
    return (
      <Btn small className="mt-1.5" onClick={() => onWhim(card)}>
        {card.label ?? "Set it up"}
      </Btn>
    );
  if (card.href)
    return (
      <Link href={card.href} className="mt-1.5 inline-block">
        <Btn small>{card.label ?? "Open"}</Btn>
      </Link>
    );
  if (card.type === "confirm" && card.action)
    return (
      <div className="mt-1.5 flex gap-2">
        <Btn
          small
          onClick={() => {
            setGone(true);
            void runAction(card.action!, tools);
          }}
        >
          {card.label ?? "Yes"}
        </Btn>
        <Btn small kind="plain" onClick={() => setGone(true)}>
          Not now
        </Btn>
      </div>
    );
  if (card.type === "choices")
    return (
      <div className="mt-1.5 flex flex-wrap gap-2">
        {card.options?.map((o) => (
          <Btn
            key={o.label}
            small
            kind="plain"
            onClick={() => {
              setGone(true);
              void runAction(o.action, tools);
            }}
          >
            {o.label}
          </Btn>
        ))}
      </div>
    );
  if (card.type === "plans" && card.plans?.length)
    return (
      <div className="mt-1.5 flex flex-wrap gap-2">
        {card.plans.map((p) => (
          <Link key={p.id} href={`/plans/${p.id}`}>
            <Btn small kind="plain">
              {p.title}
            </Btn>
          </Link>
        ))}
      </div>
    );
  return null;
}
