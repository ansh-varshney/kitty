"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, dayTime, money, shortDay, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { Bar, Btn, Card, Chip, Count, Field, H2, Icon, Paper, Scene, Sheet, Soft, Title, Waiting } from "@/components/app/ui";
import { JarSheet } from "@/components/app/jar";

/** My Month (PRD §B20): private. Your money with friends, and your calendar. */

type Person = { key: string; squadId: string; squad: string; otherId: string; name: string; look: Record<string, unknown> | null; iOwe: boolean; cents: number };
type Spent = { key: string; kind: string; title: string; sub: string; cents: number; at: string; href: string; upcoming?: boolean };
type Kitty = { squadId: string; name: string; squad: string; balanceCents: number; active: boolean; monthlyCents: number; nextAt: string | null; thisMonthCents: number };

type Month = {
  money: {
    meter: { spentCents: number; committedCents: number; budgetCents: number | null; leftCents: number | null };
    jar: { availableCents: number; heldCents: number; fullCents: number };
    people: Person[];
    settleUp: { planExtras: { plan_id: string; title: string; squad: string; cents: number }[] };
    spent: Spent[];
    kitties: Kitty[];
  };
  calendar: {
    plans: { id: string; title: string; startsAt: string; endsAt: string | null; decideBy: string; status: string }[];
    decideBy: { id: string; title: string; decideBy: string }[];
    busy: { id: string; start: string; end: string; label: string | null }[];
  };
};
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

export default function Page() {
  const { data } = useData<Month>("month");
  const { data: me } = useData<Me>("me");
  const [view, setView] = useState<"money" | "calendar">("money");
  const m = data?.money.meter;
  const used = m ? m.spentCents + m.committedCents : 0;
  const over = Boolean(m?.budgetCents != null && used > (m?.budgetCents ?? 0));
  const pct = m?.budgetCents ? (used / m.budgetCents) * 100 : 0;
  return (
    <>
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-4">
            <Title>My Month</Title>
            <Soft className="mt-1 !text-ink">Only you can see this.</Soft>
          </div>
          <LiveKitten look={me?.kitten?.look} mood={over ? "alert" : pct > 80 ? "thinking" : "happy"} size={126} title={me?.kitten?.name} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-4">
        <div className="flex gap-1.5">
          <Chip on={view === "money"} onClick={() => setView("money")}>
            Money
          </Chip>
          <Chip on={view === "calendar"} onClick={() => setView("calendar")}>
            Calendar
          </Chip>
        </div>
        {!data && <Waiting />}
        {data && view === "money" && <Money data={data} pct={pct} kitten={me?.kitten?.name ?? "your kitten"} />}
        {data && view === "calendar" && <Calendar data={data} />}
      </Paper>
    </>
  );
}

const rowCls = "press slide-up flex items-center gap-2.5 rounded-2xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]";

function Money({ data, pct, kitten }: { data: Month; pct: number; kitten: string }) {
  const { act } = useMoments();
  const [jarOpen, setJarOpen] = useState(false);
  const { meter, jar, people, settleUp, spent, kitties } = data.money;
  const nothingToSettle = !people.length && !settleUp.planExtras.length;
  const full = jar.fullCents || 1;
  const left = Math.max(0, Math.min(100, (jar.availableCents / full) * 100));
  return (
    <div key="money" className="page-in space-y-4">
      <Card>
        {meter.budgetCents != null ? (
          <>
            <p className="text-[34px] font-extrabold leading-10">
              <Count cents={meter.spentCents + meter.committedCents} />
            </p>
            <Soft>of your {money(meter.budgetCents)} fun budget</Soft>
            <div className="mt-2">
              <Bar pct={pct} />
            </div>
            <Soft className="mt-2">
              {money(meter.spentCents)} spent, {money(meter.committedCents)} set aside. {(meter.leftCents ?? 0) >= 0 ? `${money(meter.leftCents ?? 0)} left.` : `${money(-(meter.leftCents ?? 0))} over.`}
            </Soft>
          </>
        ) : (
          <p className="text-[34px] font-extrabold leading-10">
            <Count cents={meter.spentCents} />
          </p>
        )}
      </Card>

      <button type="button" aria-label={`Treat Jar: ${money(jar.availableCents)} left. Add or take out money.`} onClick={() => setJarOpen(true)} className="press slide-up block w-full rounded-3xl bg-card p-4 text-left shadow-[0_2px_0_var(--color-line)]">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[16px] font-extrabold">Treat Jar</span>
          <span className="text-[16px] font-extrabold">{money(jar.availableCents)} left</span>
        </span>
        <span className="relative mt-3 block h-2.5 rounded-full bg-[rgba(42,34,69,0.1)]">
          <span className="absolute inset-y-0 left-0 rounded-full bg-honey transition-[width] duration-700 ease-out" style={{ width: `${left}%` }} />
          <span className="absolute top-1/2 h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-honey bg-card transition-[left] duration-700 ease-out" style={{ left: `clamp(9px, ${left}%, calc(100% - 9px))` }} />
        </span>
        {jar.heldCents > 0 && <span className="mt-2 block text-[13px] text-soft">{money(jar.heldCents)} set aside for plans</span>}
      </button>

      <section className="space-y-2">
        <H2>Settle up</H2>
        {nothingToSettle && (
          <Card className="text-center">
            <p className="font-serif text-[20px] font-bold">Nothing to untangle.</p>
          </Card>
        )}
        {people.map((p, i) => (
          <div key={p.key} className={rowCls.replace("press ", "")} style={{ ["--delay" as string]: `${i * 35}ms` }}>
            <LiveKitten look={p.look ?? undefined} view="head" size={38} tappable={false} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{p.name}</span>
              <span className="block truncate text-[13px] text-soft">
                {p.iOwe ? "You owe" : "Owes you"} {money(p.cents)}, {p.squad}
              </span>
            </span>
            <span className="flex shrink-0 gap-1.5">
              {!p.iOwe && (
                <Btn small kind="plain" onClick={() => void act("sending", () => api("POST", "settle-up/nudge", { squadId: p.squadId, otherId: p.otherId }), { done: "Sent to their kitten." })}>
                  Nudge
                </Btn>
              )}
              <Btn small onClick={() => void act("untangle", () => api("POST", "settle-up/with", { squadId: p.squadId, otherId: p.otherId }), { done: "Untangled." })}>
                Untangle
              </Btn>
            </span>
          </div>
        ))}
        {settleUp.planExtras.map((x) => (
          <div key={x.plan_id} className={rowCls.replace("press ", "")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{x.title}</span>
              <span className="block truncate text-[13px] text-soft">A bit extra, {x.squad}</span>
            </span>
            <Btn small onClick={() => void act("settled", () => api("POST", `plans/${x.plan_id}/overrun/pay`), { done: "All squared." })}>
              Pay {money(x.cents)}
            </Btn>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <H2>Spent</H2>
        {!spent.length && <Soft>Nothing yet this month.</Soft>}
        {spent.map((x, i) => (
          <Link key={x.key} href={x.href} className={rowCls} style={{ ["--delay" as string]: `${Math.min(i, 8) * 35}ms` }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{x.title}</span>
              <span className="block truncate text-[13px] text-soft">
                {x.upcoming ? `Next ${shortDay(x.at)}` : shortDay(x.at)}, {x.sub}
              </span>
            </span>
            <span className={`shrink-0 text-[15px] font-extrabold ${x.upcoming ? "text-soft" : ""}`}>{x.cents < 0 ? `+${money(-x.cents)}` : money(x.cents)}</span>
            <Icon i="chev" size={16} />
          </Link>
        ))}
      </section>

      <section className="space-y-2">
        <H2>Saved</H2>
        {!kitties.length && <Soft>You&apos;re not saving in a Kitty Party yet.</Soft>}
        {kitties.map((k, i) => (
          <Link key={k.squadId} href={`/squads/${k.squadId}?tab=party`} className={rowCls} style={{ ["--delay" as string]: `${i * 35}ms` }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-extrabold">{k.name}</span>
              <span className="block truncate text-[13px] text-soft">{k.active ? `${money(k.monthlyCents)} a month${k.nextAt ? `, next ${shortDay(k.nextAt)}` : ""}` : `Paused, ${k.squad}`}</span>
            </span>
            <span className="shrink-0 text-[15px] font-extrabold">{money(k.balanceCents)}</span>
            <Icon i="chev" size={16} />
          </Link>
        ))}
      </section>

      <a href="/api/v1/export/month.csv" className="block text-center text-[14px] font-bold text-soft underline">
        Download this month
      </a>
      {jarOpen && <JarSheet jar={jar} name={kitten} onClose={() => setJarOpen(false)} />}
    </div>
  );
}

function Calendar({ data }: { data: Month }) {
  const { act } = useMoments();
  const [adding, setAdding] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const { plans, decideBy, busy } = data.calendar;
  const [opened] = useState(() => Date.now());
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const year = cursor.getFullYear();
  const mon = cursor.getMonth();

  const marks = useMemo(() => {
    const out = new Map<number, Set<string>>();
    const add = (d: Date, k: string) => {
      if (d.getFullYear() !== year || d.getMonth() !== mon) return;
      const s = out.get(d.getDate()) ?? new Set();
      s.add(k);
      out.set(d.getDate(), s);
    };
    plans.forEach((p) => add(new Date(p.startsAt), "plan"));
    decideBy.forEach((p) => add(new Date(p.decideBy), "decide"));
    busy.forEach((b) => {
      for (let t = new Date(b.start); t <= new Date(b.end); t = new Date(t.getTime() + 86_400_000)) add(t, "busy");
    });
    return out;
  }, [plans, decideBy, busy, year, mon]);

  const first = new Date(year, mon, 1).getDay();
  const days = new Date(year, mon + 1, 0).getDate();
  const today = new Date();
  const isThisMonth = today.getFullYear() === year && today.getMonth() === mon;
  const list = [
    ...plans.map((p) => ({ at: p.startsAt, text: p.title, sub: "You're in", href: `/plans/${p.id}` })),
    ...decideBy.map((p) => ({ at: p.decideBy, text: p.title, sub: "Decide by", href: `/plans/${p.id}` })),
  ]
    .filter((x) => new Date(x.at).getTime() > opened - 86_400_000)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <div key="calendar" className="page-in space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Previous month" className="press p-1" onClick={() => setCursor(new Date(year, mon - 1, 1))}>
            <Icon i="back" size={20} />
          </button>
          <p className="text-[16px] font-extrabold">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</p>
          <button type="button" aria-label="Next month" className="press p-1" onClick={() => setCursor(new Date(year, mon + 1, 1))}>
            <Icon i="chev" size={20} />
          </button>
        </div>
        <div className="mt-2 grid grid-cols-7 gap-y-1 text-center text-[13px]">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <span key={i} className="font-extrabold text-soft">
              {d}
            </span>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const k = marks.get(d);
            return (
              <span key={d} className={`relative mx-auto grid h-9 w-9 place-items-center rounded-full font-bold ${isThisMonth && today.getDate() === d ? "bg-ink text-white" : ""}`}>
                {d}
                {k && (
                  <span className="absolute bottom-0.5 flex gap-0.5">
                    {k.has("plan") && <i className="h-1.5 w-1.5 rounded-full bg-leaf" />}
                    {k.has("decide") && <i className="h-1.5 w-1.5 rounded-full bg-honey" />}
                    {k.has("busy") && <i className="h-1.5 w-1.5 rounded-full bg-lilac" />}
                  </span>
                )}
              </span>
            );
          })}
        </div>
        <div className="mt-2 flex justify-center gap-3 text-[12px] font-bold text-soft">
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-leaf" />Plan</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-honey" />Decide by</span>
          <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-lilac" />Busy</span>
        </div>
      </Card>

      {list.length > 0 && (
        <section className="space-y-2">
          <H2>Next up</H2>
          {list.slice(0, 8).map((x, i) => (
            <Link key={x.href + x.sub} href={x.href} className="press slide-up flex items-center justify-between gap-2 rounded-2xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${i * 40}ms` }}>
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-extrabold">{x.text}</span>
                <span className="block text-[13px] text-soft">
                  {x.sub} {dayTime(x.at)}
                </span>
              </span>
              <Icon i="chev" size={16} />
            </Link>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <H2>Busy times</H2>
        <Soft>Friends&apos; kittens only learn you&apos;re busy, never why.</Soft>
        {busy.map((b) => (
          <div key={b.id} className="slide-up flex items-center justify-between gap-2 rounded-2xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]">
            <span>
              <span className="block text-[15px] font-extrabold">{b.label || "Busy"}</span>
              <span className="block text-[13px] text-soft">
                {shortDay(b.start)} to {shortDay(b.end)}
              </span>
            </span>
            <button type="button" aria-label="Remove" onClick={() => void act("released", () => api("DELETE", `busy/${b.id}`), { done: "Free again." })}>
              <Icon i="close" size={16} />
            </button>
          </div>
        ))}
        <Btn kind="plain" onClick={() => setAdding(true)}>
          Add busy time
        </Btn>
      </section>

      {adding && (
        <Sheet title="Add busy time" onClose={() => setAdding(false)}>
          <div className="space-y-3">
            <Field label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Field label="To" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
            <Field label="What is it (private)" maxLength={40} placeholder="Exams" value={label} onChange={(e) => setLabel(e.target.value)} />
            <Btn
              disabled={!from || !to || to < from}
              onClick={() => {
                setAdding(false);
                void act("thinking", () => api("POST", "busy", { startsAt: new Date(`${from}T00:00`).toISOString(), endsAt: new Date(`${to}T23:59`).toISOString(), label: label.trim() || undefined }), { done: "Noted." });
              }}
            >
              Save
            </Btn>
          </div>
        </Sheet>
      )}
    </div>
  );
}
