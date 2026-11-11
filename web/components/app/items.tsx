"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, dayTime, money, refreshAll, useData } from "@/lib/client/api";
import { useMoments, type MomentKind } from "./moments";
import { Btn, Field, Icon, Sheet, Soft } from "./ui";

/** A "Needs you" card: one tap, whatever it is (FR-MEOW-2). The same card works in Meows, alerts and the kitten chat. */

export type Action = { method: "GET" | "POST" | "DELETE"; path: string; body?: Record<string, unknown> };
export type Item = {
  key?: string;
  text: string;
  action?: Action;
  choices?: { label: string; action: Action }[];
  reply?: Action & { field: string };
  approveUrl?: string;
  whim?: { id: string };
  from?: { name: string; look: unknown };
  card?: { id: string };
  replyLabel?: string;
  replyHint?: string;
};

type Tools = { router: ReturnType<typeof useRouter>; act: ReturnType<typeof useMoments>["act"]; toast: (t: string) => void };

/** Which moment plays for which action. */
export function momentFor(path: string): MomentKind {
  if (/paw-up/.test(path)) return "pawUp";
  if (/\/paw$/.test(path)) return "pawIn";
  if (/\/pounce$/.test(path)) return "pounce";
  if (/settlements\/.*\/pay|overrun\/pay/.test(path)) return "settled";
  if (/\/counter$/.test(path)) return "sending";
  if (/untangle/.test(path)) return "untangle";
  if (/yarn\/cards/.test(path)) return "settled";
  if (/^help/.test(path)) return "helping";
  if (/^friends\//.test(path)) return "sending";
  if (/^receipts\//.test(path)) return "leftovers";
  if (/^suggestions\/.*\/accept/.test(path)) return "sending";
  if (/^suggestions\/.*\/reject/.test(path)) return "released";
  if (/^gifts/.test(path)) return "catnip";
  if (/bowls|party/.test(path)) return "saving";
  if (/respond|cancel/.test(path)) return "released";
  if (/answers|kitten\/answer|whims/.test(path)) return "sending";
  if (/jar\/topup/.test(path)) return "saving";
  return "thinking";
}

/** Where an action goes in the app when it opens a screen instead of doing something. */
function screenFor(a: Action): string | null {
  let m;
  if ((m = /^plans\/([^/]+)\/receipt$/.exec(a.path))) return `/plans/${m[1]}?do=receipt`;
  if ((m = /^plans\/([^/]+)\/pay-booking$/.exec(a.path))) return `/plans/${m[1]}?do=pay`;
  if (a.method !== "GET") return null;
  if ((m = /^plans\/([^/]+)$/.exec(a.path))) return `/plans/${m[1]}`;
  if ((m = /^squads\/([^/]+)\/party$/.exec(a.path))) return `/squads/${m[1]}?tab=party`;
  if ((m = /^squads\/([^/]+)\/party\/join$/.exec(a.path))) return `/squads/${m[1]}?tab=party&do=join`;
  if ((m = /^squads\/([^/]+)\/bowls\/([^/]+)\/join$/.exec(a.path))) return `/squads/${m[1]}?tab=bowl&open=${m[2]}`;
  if ((m = /^gifts\/([^/]+)$/.exec(a.path))) return `/gifts/${m[1]}`;
  if ((m = /^help\/([^/]+)$/.exec(a.path))) return `/kitten/lives?open=${m[1]}`;
  return null;
}

export async function runAction(a: Action, { router, act }: Tools, done?: string) {
  const screen = screenFor(a);
  if (screen) {
    router.push(screen);
    return;
  }
  // Putting a card aside is quiet: no celebration for "not now".
  if (a.path === "kitten/cards/dismiss") {
    await api(a.method, a.path, a.body).catch(() => undefined);
    refreshAll();
    return;
  }
  const r = await act(momentFor(a.path), () => api(a.method, a.path, a.body), { done: done ?? "Done!" });
  const gift = /^gifts\/([^/]+)\/join$/.exec(a.path);
  if (r && gift) router.push(`/gifts/${gift[1]}`);
  return r;
}

export async function runItem(item: Item, tools: Tools) {
  if (item.approveUrl) {
    window.location.href = item.approveUrl;
    return;
  }
  if (item.action) return runAction(item.action, tools);
}

/** The answers to a card: the same buttons in the kitten's chat, in Meows, in Settle up and on the card itself. */
export function NeedButtons({ item, onDone }: { item: Item; onDone?: () => void }) {
  const router = useRouter();
  const { act, toast } = useMoments();
  const tools = { router, act, toast };
  const [typing, setTyping] = useState(false);
  const [reply, setReply] = useState("");
  const run = async (a: Action, done?: string) => {
    await runAction(a, tools, done);
    onDone?.();
  };
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {item.approveUrl && <Btn small onClick={() => void runItem(item, tools)}>Refill with PayPal</Btn>}
        {item.choices?.map((c, i) => (
          <Btn key={c.label} small kind={i === 0 ? "main" : "plain"} onClick={() => void run(c.action)}>
            {c.label}
          </Btn>
        ))}
        {item.action && !item.choices && !item.approveUrl && (
          <Btn small onClick={() => void runItem(item, tools)}>
            {item.action.method === "GET" ? "Open" : labelFor(item.action.path)}
          </Btn>
        )}
        {item.reply && !typing && (
          <Btn small kind="plain" onClick={() => setTyping(true)}>
            {item.replyLabel ?? "Type a reply"}
          </Btn>
        )}
      </div>
      {item.reply && typing && (
        <form
          className="pop-in mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void run({ method: item.reply!.method, path: item.reply!.path, body: { ...item.reply!.body, [item.reply!.field]: reply.trim() } }, "Told their kitten.");
          }}
        >
          <Field value={reply} autoFocus maxLength={200} placeholder={item.replyHint ?? "Your reply"} onChange={(e) => setReply(e.target.value)} />
          <Btn small type="submit" aria-label="Send">
            <Icon i="send" size={18} />
          </Btn>
        </form>
      )}
    </>
  );
}

type CardView = { id: string; note: string; totalCents: number; kind: string; status: string; createdAt: string; squad: string; payerName: string; paidByMe: boolean; myCents: number | null; people: { name: string; word: string; cents: number | null }[]; history: { at: string; text: string }[]; turns: Item[] };

/** "See the card": everything about one "I paid" card, and how it got here. */
export function SeeCard({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="press text-[13px] font-extrabold underline decoration-dotted underline-offset-4">
        See the card
      </button>
      {open && <CardSheet id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function CardSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error } = useData<CardView>(`yarn/cards/${id}`);
  if (error)
    return (
      <Sheet title="This card" onClose={onClose}>
        <Soft>{error.message}</Soft>
      </Sheet>
    );
  if (!data) return null;
  return (
    <Sheet title={data.note[0].toUpperCase() + data.note.slice(1)} onClose={onClose}>
      <p className="text-[30px] font-extrabold leading-9">{money(data.totalCents)}</p>
      <Soft>
        {data.paidByMe ? "You paid" : `${data.payerName} paid`} · {dayTime(data.createdAt)} · {data.squad}
      </Soft>
      {data.myCents != null && <p className="mt-3 rounded-2xl bg-honey-soft px-3.5 py-2.5 text-[16px] font-extrabold">Your part: {money(data.myCents)}</p>}
      {data.people.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.people.map((p) => (
            <div key={p.name} className="flex items-baseline justify-between gap-2 text-[15px]">
              <span className="font-bold">{p.name}</span>
              <span className="text-[13px] text-soft">
                {p.cents != null ? `${money(p.cents)} · ` : ""}
                {p.word}
              </span>
            </div>
          ))}
        </div>
      )}
      {data.history.length > 0 && (
        <div className="mt-3 space-y-1 border-t border-line pt-2">
          {data.history.map((h, i) => (
            <Soft key={i}>{h.text}</Soft>
          ))}
        </div>
      )}
      {data.turns.map((t) => (
        <div key={t.key} className="mt-3 border-t border-line pt-2">
          <p className="text-[15px] leading-[21px]">{t.text}</p>
          <NeedButtons item={t} onDone={onClose} />
        </div>
      ))}
    </Sheet>
  );
}

export function NeedCard({ item, delay, flat }: { item: Item; delay?: number; flat?: boolean }) {
  return (
    <div className={flat ? "" : "slide-up rounded-2xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]"} style={delay ? ({ ["--delay" as string]: `${delay}ms` }) : undefined}>
      <div className="flex items-start gap-2.5">
        {item.from && <LiveKitten look={item.from.look as Record<string, unknown>} view="head" size={40} tappable={false} title={item.from.name} className="shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-[21px]">{item.text}</p>
          {item.card && <SeeCard id={item.card.id} />}
          {item.whim && (
            <Link href={`/whims/${item.whim.id}`} className="press text-[13px] font-extrabold underline decoration-dotted underline-offset-4">
              See the kittens&apos; chat
            </Link>
          )}
        </div>
      </div>
      <NeedButtons item={item} />
    </div>
  );
}

const labelFor = (p: string) =>
  /pay$/.test(p) ? "Pay" : /confirm/.test(p) ? "Yep" : /receipt/.test(p) ? "Add receipt" : /pledge/.test(p) ? "Pledge" : /join/.test(p) ? "Join" : /paw-up/.test(p) ? "Yes, more" : "Do it";
