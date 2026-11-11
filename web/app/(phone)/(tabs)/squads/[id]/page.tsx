"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, money, shortDay, toCents, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { PlusSheets, type PlusMode } from "@/components/app/plus";
import { GroupActions, type SettleGroup } from "@/components/app/settle";
import { Back, Bar, Btn, Card, Chip, Field, H2, Icon, Label, Note, Sheet, Soft, Stepper, Title, Toggle, Waiting } from "@/components/app/ui";
import type { Mood } from "@/lib/kitten/looks";
import { ordinal } from "@/lib/referee/time";

/** A squad's rooftop (PRD §B5): the kittens up top, then Chat, Plans, Yarn, Party, Bowl and your own settings. */

type Look = Record<string, unknown>;
type Member = { id: string; name: string; kitten_name: string | null; kitten_look: Look | null; role: string };
type SquadView = { squad: { id: string; name: string; kind: string; invite_code: string; leftovers_to_savings: boolean; archived_at: string | null }; members: Member[]; savingsCents: number };
type Feed = { id: number; type: string; actor: string; actorId: string | null; mine: boolean; objectType: string | null; objectId: string | null; public: { text?: string; name?: string; userId?: string; status?: string }; createdAt: string };
type Party = { party: null | { id: string; name: string; goalCents: number | null; interval: string }; jarCents?: number; goalPct?: number | null; savers?: { name: string; monthlyCents: number }[]; myJarCents?: number; mine?: null | { monthly_cents: number; status: string; collected_count: number; save_day: number | null; next_save_at: string | null; balanceCents: number } };
type Purrs = { topCat: { name: string; purrs: number } | null; streak: number; tags: { name: string; tag: string }[] };

const TABS = [
  ["chat", "Chat"],
  ["plans", "Plans"],
  ["yarn", "Yarn"],
  ["party", "Party"],
  ["bowl", "Bowl"],
  ["mine", "My settings"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function Page() {
  return (
    <Suspense>
      <Rooftop />
    </Suspense>
  );
}

function Rooftop() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const initial = (params.get("tab") as Tab) ?? "chat";
  const [tab, setTab] = useState<Tab>(TABS.some(([t]) => t === initial) ? initial : "chat");
  const [plus, setPlus] = useState<PlusMode>(null);
  const [invite, setInvite] = useState(params.get("invite") === "1");
  const { data } = useData<SquadView>(`squads/${id}`);
  const { data: feed } = useData<Feed[]>(`squads/${id}/feed`);
  const { data: me } = useData<{ user: { id: string } }>("me");
  const { data: party } = useData<Party>(`squads/${id}/party`);
  const { data: purrs } = useData<Purrs>(`squads/${id}/purrs`);
  const { data: gifts } = useData<{ group_id: string; squad_id: string | null }[]>("gifts");
  const gift = gifts?.find((g) => g.squad_id === id);

  const newest = feed?.[0];
  const mood: Mood = newest && ["pounce", "plan.settled", "yarn.clear", "pounce.paid_booker"].includes(newest.type) ? "happy" : newest && ["pounce.paused", "plan.on_ice"].includes(newest.type) ? "thinking" : "neutral";
  const members = data?.members ?? [];
  const shown = members.slice(0, 6);
  const size = shown.length > 5 ? 62 : shown.length > 4 ? 72 : shown.length > 3 ? 86 : 104;
  const meId = me?.user.id;

  return (
    <div className="absolute inset-0 flex flex-col bg-paper">
      <div className="relative shrink-0" style={{ backgroundImage: "url(/sky/tall.svg)", backgroundSize: "cover", backgroundPosition: "center top" }}>
        <div className="px-4 pt-[max(14px,env(safe-area-inset-top))]">
          <div className="flex items-center gap-1">
            <Back href="/squads" />
            <Title className="min-w-0 flex-1 truncate !text-[26px] !leading-8">{data?.squad.name ?? "..."}</Title>
            {party?.party && (
              <button type="button" className="press mr-1 flex shrink-0 flex-col items-center" aria-label={`Kitty Party: ${party.goalPct ?? 0}% of the goal`} onClick={() => setTab("party")}>
                <span className="h-[3px] w-3.5 rounded-full bg-ink" />
                <span className="relative block h-[22px] w-[20px] overflow-hidden rounded-b-[7px] rounded-t-[3px] border-2 border-ink bg-card">
                  <span className="absolute inset-x-0 bottom-0 bg-leaf transition-[height] duration-700" style={{ height: `${party.goalPct ?? 0}%` }} />
                </span>
              </button>
            )}
            {data?.squad.kind !== "gift" && (
              <button type="button" className="press rounded-full bg-card px-3 py-1.5 text-[13px] font-extrabold shadow-[0_2px_0_var(--color-line)]" onClick={() => setInvite(true)}>
                Invite
              </button>
            )}
          </div>
          {purrs && (purrs.topCat || purrs.streak > 1) && (
            <Soft className="mt-0.5 pl-9 !text-ink">
              {purrs.topCat ? `Top Cat: ${purrs.topCat.name}` : ""}
              {purrs.topCat && purrs.streak > 1 ? " · " : ""}
              {purrs.streak > 1 ? `${purrs.streak} plans in a row` : ""}
            </Soft>
          )}
        </div>

        <div className="relative mt-1 flex h-[118px] items-end justify-center overflow-hidden">
          {shown.map((m, i) =>
            m.id === meId ? (
              <div key={m.id} className="slide-up -mx-1 shrink-0" style={{ ["--delay" as string]: `${i * 90}ms` }}>
                <LiveKitten look={m.kitten_look ?? undefined} mood={mood} size={size} reactKey={feed?.length ?? 0} title={m.kitten_name ?? m.name} />
              </div>
            ) : (
              <Link key={m.id} href={`/chat/${m.id}`} aria-label={`Chat with ${m.name}`} className="slide-up -mx-1 shrink-0" style={{ ["--delay" as string]: `${i * 90}ms` }}>
                <LiveKitten look={m.kitten_look ?? undefined} mood={mood} size={size} reactKey={feed?.length ?? 0} title={m.kitten_name ?? m.name} tappable={false} />
              </Link>
            ),
          )}
        </div>
        <div className="h-3 bg-honey-edge" />
      </div>

      <div className="flex shrink-0 gap-1.5 overflow-x-auto bg-paper px-3 py-2.5 no-scrollbar">
        {TABS.filter(([t]) => data?.squad.kind !== "gift" || t === "chat" || t === "plans").map(([t, l]) => (
          <Chip key={t} on={tab === t} onClick={() => setTab(t)}>
            {l}
          </Chip>
        ))}
      </div>

      {gift && (
        <Link href={`/gifts/${gift.group_id}`} className="block shrink-0 px-4 pb-2">
          <Btn kind="ink">Open the secret gift</Btn>
        </Link>
      )}
      {data && tab === "chat" ? (
        <ChatTab squadId={id} feed={feed ?? []} meId={meId} members={members} />
      ) : (
        <div key={tab} className="page-in min-h-0 flex-1 overflow-y-auto bg-paper px-4 pb-8 no-scrollbar">
          {!data && <Waiting />}
          {data && tab === "plans" && <PlansTab squadId={id} onNew={() => setPlus("whim")} />}
          {data && tab === "yarn" && <YarnTab squadId={id} onPaid={() => setPlus("paid")} />}
          {data && tab === "party" && <PartyTab squadId={id} data={party} openJoin={params.get("do") === "join"} amount={Number(params.get("amount")) || 25} />}
          {data && tab === "bowl" && <BowlTab squadId={id} members={members} meId={meId} initialOpen={params.get("open")} />}
          {data && tab === "mine" && <MineTab view={data} meId={meId} />}
        </div>
      )}

      <PlusSheets mode={plus} setMode={setPlus} squadId={id} />
      {invite && data && <InviteSheet name={data.squad.name} code={data.squad.invite_code} onClose={() => setInvite(false)} />}
    </div>
  );
}

function InviteSheet({ name, code, onClose }: { name: string; code: string; onClose: () => void }) {
  const { toast } = useMoments();
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
  return (
    <Sheet title={`Invite to ${name}`} onClose={onClose}>
      <Soft>Friends tap the link, log in with PayPal, and their kitten joins the rooftop.</Soft>
      <p className="mt-3 break-all rounded-2xl bg-inset p-3 text-[14px] font-semibold">{link}</p>
      <p className="mt-3 text-center text-[13px] font-bold text-soft">
        Or share the code <span className="text-ink">{code}</span>
      </p>
      <Btn
        className="mt-3"
        onClick={() => {
          void navigator.clipboard?.writeText(link).then(() => toast("Link copied."));
        }}
      >
        Copy the link
      </Btn>
    </Sheet>
  );
}

// ----------------------------------------------------------------- Chat

function ChatTab({ squadId, feed, meId, members }: { squadId: string; feed: Feed[]; meId?: string; members: Member[] }) {
  const { toast, act } = useMoments();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const rows = [...feed].reverse();

  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [feed.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText("");
    setSending(true);
    try {
      await api("POST", `squads/${squadId}/messages`, { text: t });
    } catch {
      toast("That didn't send. Try again.");
      setText(t);
    }
    setSending(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={list} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-2 no-scrollbar">
        {!rows.length && <Soft className="py-6 text-center">Nothing here yet. Say hello, or float a whim.</Soft>}
        {rows.map((f) => {
          if (f.type === "chat.squad") {
            const mine = f.public.userId === meId;
            return (
              <div key={f.id} className={`pop-in flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-md bg-honey-soft" : "rounded-bl-md bg-card shadow-[0_2px_0_var(--color-line)]"}`}>
                  {!mine && <p className="text-[12px] font-extrabold text-soft">{f.public.name}</p>}
                  <p className="text-[15px] leading-[21px]">{f.public.text}</p>
                </div>
              </div>
            );
          }
          const line = feedLine(f, members);
          if (!line) return null;
          const inner = <p className="rounded-2xl bg-inset px-3 py-2 text-center text-[13px] font-semibold leading-[18px]">{line}</p>;
          if (f.type === "whim.floated" && f.mine && f.objectId)
            return (
              <div key={f.id} className="pop-in mx-auto max-w-[92%] text-center">
                {inner}
                <button type="button" className="press mt-1 text-[12px] font-extrabold text-soft underline" onClick={() => void act("released", () => api("POST", `whims/${f.objectId}/withdraw`), { done: "Taken back." })}>
                  Take it back
                </button>
              </div>
            );
          if (f.objectType === "whim" && f.objectId && f.type !== "whim.withdrawn")
            return (
              <Link key={f.id} href={`/whims/${f.objectId}`} className="press pop-in mx-auto block max-w-[92%]">
                {inner}
              </Link>
            );
          return f.objectType === "plan" && f.objectId ? (
            <Link key={f.id} href={`/plans/${f.objectId}`} className="press pop-in mx-auto block max-w-[92%]">
              {inner}
            </Link>
          ) : (
            <div key={f.id} className="pop-in mx-auto max-w-[92%]">
              {inner}
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="flex shrink-0 gap-2 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2">
        <input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Message the squad" className="min-w-0 flex-1 rounded-2xl bg-card px-4 py-3 text-[16px] shadow-[inset_0_0_0_1.5px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-honey)]" />
        <Btn small type="submit" disabled={!text.trim() || sending} aria-label="Send" className="!px-4">
          <Icon i="send" size={20} />
        </Btn>
      </form>
    </div>
  );
}

const feedLine = (f: Feed, members: Member[]): string | null => {
  // "can't make it" only reads right with a name in front of it.
  if (f.public.status && f.public.userId) return `${members.find((m) => m.id === f.public.userId)?.name ?? "Someone"} ${f.public.text}`;
  if (f.public.text) return f.public.text;
  if (f.type === "squad.joined") return "A new kitten climbed up to the rooftop.";
  if (f.type === "squad.created") return "The rooftop opened.";
  return null;
};

// ----------------------------------------------------------------- Plans

type PlanRow = { id: string; title: string; status: string; starts_at: string | null; decide_by: string; price_cents: number; squad_id: string; my_status: string | null };
type WhimRow = { id: string; what: string; talk: number; yes: number; total: number; need_at_least: number };
const STATUS: Record<string, string> = { open: "Collecting", pouncing: "Pouncing", pounced: "Happening", settled: "Done", on_ice: "On ice", cancelled: "Cancelled" };

function PlansTab({ squadId, onNew }: { squadId: string; onNew: () => void }) {
  const { data } = useData<PlanRow[]>("plans");
  const { data: whims } = useData<WhimRow[]>(`squads/${squadId}/whims`);
  const plans = (data ?? []).filter((p) => p.squad_id === squadId);
  const live = plans.filter((p) => ["open", "pouncing", "pounced", "on_ice"].includes(p.status));
  const past = plans.filter((p) => p.status === "settled");
  return (
    <div className="space-y-2.5">
      {!data && <Waiting />}
      {(whims ?? []).map((w, i) => (
        <Link key={w.id} href={`/whims/${w.id}`} className="press slide-up block rounded-3xl bg-card p-3.5 shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${i * 50}ms` }}>
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[16px] font-extrabold">{w.what}</p>
            <span className="shrink-0 rounded-full bg-honey-soft px-2.5 py-1 text-[12px] font-extrabold">Deciding</span>
          </div>
          <Soft className="mt-0.5">
            {w.yes + 1} of {w.total + 1} said yes, needs {w.need_at_least}
            {w.talk ? " · Kittens are talking" : ""}
          </Soft>
        </Link>
      ))}
      {data && !plans.length && !(whims ?? []).length && (
        <Card className="text-center">
          <p className="text-[15px]">No plans yet. Float a whim and the kittens will ask around.</p>
        </Card>
      )}
      {live.map((p, i) => (
        <PlanLink key={p.id} p={p} delay={i * 50} />
      ))}
      <Btn onClick={onNew}>New whim</Btn>
      {past.length > 0 && <H2 className="pt-2">Past plans</H2>}
      {past.map((p) => (
        <PlanLink key={p.id} p={p} />
      ))}
    </div>
  );
}

function PlanLink({ p, delay }: { p: PlanRow; delay?: number }) {
  return (
    <Link href={`/plans/${p.id}`} className="press slide-up block rounded-3xl bg-card p-3.5 shadow-[0_2px_0_var(--color-line)]" style={delay ? ({ ["--delay" as string]: `${delay}ms` }) : undefined}>
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-[16px] font-extrabold">{p.title}</p>
        <span className="shrink-0 rounded-full bg-leaf-soft px-2.5 py-1 text-[12px] font-extrabold">{STATUS[p.status] ?? p.status}</span>
      </div>
      <Soft className="mt-0.5">
        {p.status === "open" ? `Pay by ${shortDay(p.decide_by)}` : p.starts_at ? shortDay(p.starts_at) : "Date to be set"}
        {p.my_status === "in" ? " · You're in" : ""}
      </Soft>
    </Link>
  );
}

// ----------------------------------------------------------------- Yarn

type OpenCard = { id: string; note: string; cents: number; status: string; waitingOn: string[]; notRight: string[] };

function YarnTab({ squadId, onPaid }: { squadId: string; onPaid: () => void }) {
  const { data } = useData<{ groups: SettleGroup[] }>("settle-up");
  const { data: cards } = useData<OpenCard[]>(`squads/${squadId}/cards`);
  const { act } = useMoments();
  const [fixing, setFixing] = useState<OpenCard | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const g = data?.groups.find((x) => x.squadId === squadId);
  return (
    <div className="space-y-3">
      {!data && <Waiting />}
      {data && !g && (
        <Card className="text-center">
          <p className="font-serif text-[20px] font-bold">All untangled.</p>
          <Soft className="mt-1">Nobody owes anybody here.</Soft>
        </Card>
      )}
      {g && <GroupActions g={g} />}
      {cards?.map((c) => (
        <Card key={c.id}>
          <p className="text-[15px] font-extrabold">
            {c.note}, {money(c.cents)}
          </p>
          <Soft className="mt-0.5">{c.notRight.length ? `${c.notRight.join(" and ")} said it's not right.` : `Waiting on ${c.waitingOn.join(" and ")}. Their kittens will nudge them.`}</Soft>
          <div className="mt-2 flex gap-2">
            <Btn small kind="plain" onClick={() => (setFixing(c), setAmount(String(c.cents / 100)), setNote(c.note))}>
              Fix it
            </Btn>
            <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `yarn/cards/${c.id}/remove`), { done: "Removed." })}>
              Remove
            </Btn>
          </div>
        </Card>
      ))}
      {fixing && (
        <Sheet title="Fix this card" onClose={() => setFixing(null)}>
          <div className="space-y-3">
            <Field label="How much" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Field label="What for" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} />
            <Soft>Everyone on the card confirms it again.</Soft>
            <Btn
              disabled={!toCents(amount) || !note.trim()}
              onClick={() => {
                const id = fixing.id;
                setFixing(null);
                void act("sending", () => api("POST", `yarn/cards/${id}/edit`, { cents: toCents(amount), note: note.trim() }), { done: "Sent back to them." });
              }}
            >
              Save
            </Btn>
          </div>
        </Sheet>
      )}
      <Btn kind="plain" onClick={onPaid}>
        I paid for something
      </Btn>
      <Soft className="text-center">Your kitten nudges friends for you. You never have to ask.</Soft>
    </div>
  );
}

// ----------------------------------------------------------------- Kitty Party

function DayGrid({ day, onPick }: { day: number; onPick: (d: number) => void }) {
  return (
    <div className="mt-1.5 grid grid-cols-7 gap-1.5">
      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
        <button key={d} type="button" aria-pressed={d === day} onClick={() => onPick(d)} className={`press h-9 rounded-xl text-[14px] font-bold ${d === day ? "bg-ink text-white" : "bg-card text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]"}`}>
          {d}
        </button>
      ))}
    </div>
  );
}

/** "today", or "on Dec 5": when a day of the month first comes round. */
const firstTime = (day: number, now: Date) => (day === now.getDate() ? "today" : `on ${new Date(now.getFullYear(), now.getMonth() + (day > now.getDate() ? 0 : 1), day).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`);

function PartyTab({ squadId, data, openJoin, amount }: { squadId: string; data?: Party; openJoin: boolean; amount: number }) {
  const { act } = useMoments();
  const [sheet, setSheet] = useState<null | "new" | "join" | "out">(openJoin ? "join" : null);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [monthly, setMonthly] = useState(amount);
  const [now] = useState(() => new Date());
  const [day, setDay] = useState(() => Math.min(new Date().getDate(), 28));
  const [out, setOut] = useState("");
  if (!data) return <Waiting />;
  const mine = data.mine;
  const saving = mine?.status === "active";
  const shortDate = (at: Date) => at.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const firstSaving = day === now.getDate() ? "today" : `on ${shortDate(new Date(now.getFullYear(), now.getMonth() + (day > now.getDate() ? 0 : 1), day))}`;
  return (
    <div className="space-y-3">
      {!data.party && (
        <Card className="text-center">
          <p className="font-serif text-[20px] font-bold">Save together</p>
          <Soft className="mt-1">Each person saves a little every month, and it stays theirs. Enjoy it together when you&apos;re ready.</Soft>
          <Btn className="mt-3" onClick={() => setSheet("new")}>
            Start a Kitty Party
          </Btn>
        </Card>
      )}
      {data.party && (
        <>
          <Card>
            <p className="font-serif text-[22px] font-bold">{data.party.name}</p>
            <p className="mt-2 text-[28px] font-extrabold">{money(data.jarCents ?? 0)}</p>
            {data.party.goalCents ? (
              <>
                <Soft>of {money(data.party.goalCents)}</Soft>
                <div className="mt-2">
                  <Bar pct={data.goalPct ?? 0} kind="leaf" />
                </div>
              </>
            ) : null}
            {data.savers?.length ? (
              <div className="mt-3 space-y-1">
                {data.savers.map((s) => (
                  <div key={s.name} className="flex items-baseline justify-between gap-3 text-[15px]">
                    <span className="min-w-0 truncate font-bold">{s.name}</span>
                    <span className="shrink-0 text-soft">{money(s.monthlyCents)} a month</span>
                  </div>
                ))}
              </div>
            ) : (
              <Soft className="mt-2">Nobody&apos;s saving yet.</Soft>
            )}
          </Card>
          <Card delay={60}>
            <H2>Yours</H2>
            {mine && <p className="mt-1 text-[15px] font-bold">{money(mine.balanceCents)} saved</p>}
            {saving && mine && (
              <Soft>
                {money(mine.monthly_cents)} a month from your Treat Jar{mine.save_day ? `, on the ${ordinal(mine.save_day)}` : ""}.{mine.next_save_at ? ` Next: ${shortDate(new Date(mine.next_save_at))}.` : ""}
              </Soft>
            )}
            <div className="mt-2.5 flex flex-wrap gap-2">
              {!saving && (
                <Btn small onClick={() => setSheet("join")}>
                  Start saving
                </Btn>
              )}
              {saving && (
                <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `squads/${squadId}/party/stop`), { done: "Stopped. Your savings stay yours." })}>
                  Stop saving
                </Btn>
              )}
              {(mine?.balanceCents ?? 0) > 0 && (
                <Btn small kind="plain" onClick={() => setSheet("out")}>
                  Withdraw
                </Btn>
              )}
            </div>
          </Card>
        </>
      )}

      {sheet === "new" && (
        <Sheet title="New Kitty Party" onClose={() => setSheet(null)}>
          <div className="space-y-3">
            <Field label="Name it" autoFocus maxLength={40} placeholder="Goa fund" value={name} onChange={(e) => setName(e.target.value)} />
            <Field label="Goal" inputMode="decimal" placeholder="$1,200" value={goal} onChange={(e) => setGoal(e.target.value)} />
            <Btn
              disabled={!name.trim() || !toCents(goal)}
              onClick={() => {
                setSheet(null);
                void act("saving", () => api("POST", `squads/${squadId}/party`, { name: name.trim(), goalCents: toCents(goal) }), { done: "The jar is out." });
              }}
            >
              Start it
            </Btn>
          </div>
        </Sheet>
      )}
      {sheet === "join" && !saving && data.party && (
        <Sheet title="How much a month?" onClose={() => setSheet(null)}>
          <div className="flex justify-center py-3">
            <Stepper value={monthly} min={1} max={500} onChange={setMonthly} format={(n) => `$${n}`} />
          </div>
          <Label>Which day each month?</Label>
          <DayGrid day={day} onPick={setDay} />
          <p className="mt-3 text-center text-[15px] font-bold">
            ${monthly} moves from your Treat Jar {firstSaving}, then the {ordinal(day)} of every month.
          </p>
          <Soft className="mt-1 text-center">Your Treat Jar has {money(data.myJarCents ?? 0)}. If it&apos;s short, your kitten asks you to top up. You can stop anytime.</Soft>
          <Btn
            className="mt-3"
            onClick={() => {
              setSheet(null);
              void act("saving", () => api("POST", `squads/${squadId}/party/join`, { monthlyCents: monthly * 100, saveDay: day }), { done: "You're saving." });
            }}
          >
            Continue
          </Btn>
        </Sheet>
      )}
      {sheet === "out" && (
        <Sheet title="Withdraw" onClose={() => setSheet(null)}>
          <Field label={`Up to ${money(mine?.balanceCents ?? 0)}. Leave empty for all of it.`} inputMode="decimal" value={out} onChange={(e) => setOut(e.target.value)} />
          <Btn
            className="mt-3"
            onClick={() => {
              setSheet(null);
              void act("released", () => api("POST", `squads/${squadId}/party/withdraw`, toCents(out) ? { cents: toCents(out) } : {}), { working: "Back to your PayPal...", done: "On its way." });
            }}
          >
            Send it to my PayPal
          </Btn>
        </Sheet>
      )}
    </div>
  );
}

// ----------------------------------------------------------------- The Bowl

type BowlRow = { id: string; service: string; total_cents: number; seats: number; status: string };
type BowlView = { bowl: { id: string; service: string; totalCents: number; seats: number; owner: boolean; ownerName: string | null; usualDay: number | null }; members: { name: string; status: string; monthlyCents: number; holder: boolean }[]; mine: null | { share_cents: number; status: string; pay_day: number | null; next_pay_at: string | null }; myJarCents: number };

function BowlTab({ squadId, members, meId, initialOpen }: { squadId: string; members: Member[]; meId?: string; initialOpen: string | null }) {
  const { act } = useMoments();
  const { data } = useData<BowlRow[]>(`squads/${squadId}/bowls`);
  const [adding, setAdding] = useState(false);
  const [service, setService] = useState("");
  const [total, setTotal] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [now] = useState(() => new Date());
  const [day, setDay] = useState(() => Math.min(new Date().getDate(), 28));
  const friends = members.filter((m) => m.id !== meId);
  const live = (data ?? []).filter((b) => b.status !== "closed");
  const seats = people.length + 1;
  const share = Math.ceil(toCents(total) / seats);

  return (
    <div className="space-y-3">
      {!data && <Waiting />}
      {data && !live.length && (
        <Card className="text-center">
          <p className="font-serif text-[20px] font-bold">Share a subscription</p>
          <Soft className="mt-1">Split a Netflix or a Spotify family. Everyone picks a day, and their share moves from their Treat Jar each month.</Soft>
          <Btn className="mt-3" onClick={() => setAdding(true)}>
            Add a subscription
          </Btn>
        </Card>
      )}
      {live.map((b) => (
        <BowlCard key={b.id} id={b.id} startJoin={initialOpen === b.id} />
      ))}
      {live.length > 0 && (
        <Btn kind="plain" onClick={() => setAdding(true)}>
          Add a subscription
        </Btn>
      )}
      {adding && (
        <Sheet title="New subscription" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <Field label="What is it" autoFocus maxLength={40} placeholder="Netflix" value={service} onChange={(e) => setService(e.target.value)} />
            <Field label="Monthly total" inputMode="decimal" placeholder="$22.99" value={total} onChange={(e) => setTotal(e.target.value)} />
            <div>
              <p className="mb-1 text-[13px] font-bold text-soft">Who shares it</p>
              <div className="flex flex-wrap gap-1.5">
                {friends.map((f) => (
                  <Chip key={f.id} on={people.includes(f.id)} onClick={() => setPeople((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                    {f.name}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <Label>Which day each month?</Label>
              <DayGrid day={day} onPick={setDay} />
            </div>
            {toCents(total) > 0 && people.length > 0 && (
              <p className="text-center text-[15px] font-bold">
                {money(share)} each, with {seats} people. Yours counts {firstTime(day, now)}, then the {ordinal(day)} of every month.
              </p>
            )}
            <Soft className="text-center">You pay the subscription yourself. Everyone else&apos;s share comes to your Treat Jar on the day they pick.</Soft>
            <Btn
              disabled={!service.trim() || !toCents(total) || !people.length}
              onClick={() => {
                setAdding(false);
                void act("saving", () => api("POST", `squads/${squadId}/bowls`, { service: service.trim(), totalCents: toCents(total), seats, memberIds: people, payDay: day }), { done: "It's in the Bowl." });
              }}
            >
              Continue
            </Btn>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** One subscription, laid out like a Kitty Party: what it is and who pays what, then your own part. */
function BowlCard({ id, startJoin }: { id: string; startJoin: boolean }) {
  const { act } = useMoments();
  const { data } = useData<BowlView>(`bowls/${id}`);
  const [sheet, setSheet] = useState(startJoin);
  const [now] = useState(() => new Date());
  const [picked, setPicked] = useState<number | null>(null);
  if (!data) return <Waiting />;
  const { bowl, members, mine } = data;
  const go = (path: string, done: string, kind: "saving" | "released" = "saving", body?: Record<string, unknown>) => {
    setSheet(false);
    void act(kind, () => api("POST", `bowls/${id}/${path}`, body ?? {}), { done });
  };
  const paying = mine?.status === "active";
  const waiting = mine?.status === "pending";
  const needsDay = waiting && !mine?.pay_day;
  const day = picked ?? bowl.usualDay ?? Math.min(now.getDate(), 28);
  return (
    <>
      <Card>
        <p className="font-serif text-[22px] font-bold">{bowl.service}</p>
        <p className="mt-2 text-[28px] font-extrabold">{money(bowl.totalCents)}</p>
        <Soft>a month, {bowl.seats} seats</Soft>
        <div className="mt-3 space-y-1">
          {members
            .filter((m) => m.status !== "left")
            .map((m) => (
              <div key={m.name} className="flex items-baseline justify-between gap-3 text-[15px]">
                <span className="min-w-0 truncate font-bold">
                  {m.name}
                  {m.holder ? " · holds the account" : ""}
                </span>
                <span className="shrink-0 text-soft">{m.status === "active" ? `${money(m.monthlyCents)} a month` : "Invited"}</span>
              </div>
            ))}
        </div>
      </Card>
      {mine && mine.status !== "left" && (
        <Card delay={60}>
          <H2>Yours</H2>
          <p className="mt-1 text-[15px] font-bold">{money(mine.share_cents)} a month</p>
          {paying && (
            <Soft>
              {bowl.owner ? "You pay the subscription yourself, and everyone else's share comes to your Treat Jar. Yours counts" : "From your Treat Jar"}
              {mine.pay_day ? `${bowl.owner ? "" : ","} on the ${ordinal(mine.pay_day)}` : ""}.{mine.next_pay_at ? ` Next: ${shortDay(mine.next_pay_at)}.` : ""}
            </Soft>
          )}
          {waiting && !needsDay && <Soft>Your share changed. Confirm it and it moves on the {ordinal(mine.pay_day ?? 1)}, as before.</Soft>}
          <div className="mt-2.5 flex flex-wrap gap-2">
            {needsDay && (
              <Btn small onClick={() => setSheet(true)}>
                {bowl.owner ? "Pick a day" : "Join"}
              </Btn>
            )}
            {waiting && !needsDay && (
              <Btn small onClick={() => go("join", "Confirmed.")}>
                Confirm
              </Btn>
            )}
            {!bowl.owner && (
              <Btn small kind="plain" onClick={() => go("leave", waiting ? "Not for you, then." : "You left it.", "released")}>
                {waiting ? "Not for me" : "Leave"}
              </Btn>
            )}
            {bowl.owner && (
              <Btn small kind="plain" onClick={() => go("close", "It's closed.", "released")}>
                Close this Bowl
              </Btn>
            )}
          </div>
        </Card>
      )}
      {sheet && needsDay && mine && (
        <Sheet title={bowl.owner ? `Your day for ${bowl.service}` : `Join ${bowl.service}`} onClose={() => setSheet(false)}>
          <Label>Which day each month?</Label>
          <DayGrid day={day} onPick={setPicked} />
          <p className="mt-3 text-center text-[15px] font-bold">
            {money(mine.share_cents)} {bowl.owner ? "counts" : "moves from your Treat Jar"} {firstTime(day, now)}, then the {ordinal(day)} of every month.
          </p>
          <Soft className="mt-1 text-center">{bowl.owner ? "Everyone else's share comes to your Treat Jar on their day." : `Your Treat Jar has ${money(data.myJarCents)}. If it's short, your kitten asks you to top up. You can leave anytime.`}</Soft>
          <Btn className="mt-3" onClick={() => go("join", bowl.owner ? "Your day is set." : "You're in the Bowl.", "saving", { payDay: day })}>
            Continue
          </Btn>
        </Sheet>
      )}
    </>
  );
}

// ----------------------------------------------------------------- My settings

type Rule = { id: string; type: string; squadId: string | null; text: string; active: boolean };

function MineTab({ view, meId }: { view: SquadView; meId?: string }) {
  const { act } = useMoments();
  const router = useRouter();
  const { data: rules } = useData<Rule[]>("rules");
  const [text, setText] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [keepName, setKeepName] = useState(view.squad.name);
  const { squad, members } = view;
  const here = (rules ?? []).filter((r) => r.squadId === squad.id && r.active);

  const add = () => {
    const t = text.trim();
    setText("");
    void act("thinking", () => api("POST", "rules", { text: t, squadId: squad.id }), { working: "Learning that...", done: "Got it." });
  };

  return (
    <div className="space-y-4">
      <section>
        <H2>Your rules here</H2>
        <Soft className="mt-0.5">Only you can see these.</Soft>
        <div className="mt-2 space-y-1.5">
          {here.map((r) => (
            <div key={r.id} className="slide-up flex items-center justify-between gap-2 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_0_var(--color-line)]">
              <p className="text-[14px]">{r.text}</p>
              <button type="button" aria-label="Remove" onClick={() => void act("released", () => api("DELETE", `rules/${r.id}`), { done: "Removed." })}>
                <Icon i="close" size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <Field placeholder="Never more than $40 for dinners" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
          <Btn small disabled={text.trim().length < 3} onClick={add}>
            Add
          </Btn>
        </div>
      </section>

      <section>
        <H2>Friends</H2>
        <div className="mt-2 space-y-1.5">
          {members
            .filter((m) => m.id !== meId)
            .map((m) => (
              <Link key={m.id} href={`/chat/${m.id}`} className="press flex w-full items-center gap-2.5 rounded-2xl bg-card p-2 text-left shadow-[0_2px_0_var(--color-line)]">
                <LiveKitten look={m.kitten_look ?? undefined} view="head" size={40} tappable={false} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-extrabold">{m.name}</span>
                  <span className="block text-[13px] text-soft">Chat, or ask {m.kitten_name ?? "their kitten"}</span>
                </span>
              </Link>
            ))}
        </div>
      </section>

      <section>
        <H2>This squad</H2>
        <button
          type="button"
          className="mt-2 flex w-full items-center justify-between gap-3 text-left"
          onClick={() => void act("thinking", () => api("POST", `squads/${squad.id}/settings`, { leftoversToSavings: !squad.leftovers_to_savings }), { done: "Changed." })}
        >
          <span className="text-[14px] font-semibold">Send leftovers to the Kitty Party instead of back to each person</span>
          <Toggle on={squad.leftovers_to_savings} />
        </button>
      </section>

      {squad.kind === "mini" && (
        <section className="space-y-2">
          <H2>Keep this group?</H2>
          <Field value={keepName} maxLength={40} onChange={(e) => setKeepName(e.target.value)} />
          <Btn kind="plain" disabled={!keepName.trim()} onClick={() => void act("sending", () => api("POST", `squads/${squad.id}/keep`, { name: keepName.trim() }), { done: "It's a squad now." })}>
            Keep as squad
          </Btn>
        </section>
      )}

      <Btn kind="soft" onClick={() => setLeaving(true)}>
        Leave this squad
      </Btn>
      {leaving && (
        <Sheet title={`Leave ${squad.name}?`} onClose={() => setLeaving(false)}>
          <Soft>You can come back with the invite link. Your kitten will tell you if something&apos;s still open here.</Soft>
          <Label>{" "}</Label>
          <div className="mt-3 space-y-2">
            <Btn
              kind="ink"
              onClick={async () => {
                setLeaving(false);
                const r = await act("released", () => api("POST", `squads/${squad.id}/leave`), { done: "You left the rooftop." });
                if (r) router.replace("/squads");
              }}
            >
              Leave
            </Btn>
            <Btn kind="plain" onClick={() => setLeaving(false)}>
              Stay
            </Btn>
          </div>
        </Sheet>
      )}
    </div>
  );
}
