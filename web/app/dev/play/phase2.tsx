"use client";

import { useCallback, useEffect, useState } from "react";

/** Phase 2 test bench: Yarn, Kitty Party, Nine Lives, Catnip, Bowl, Meows, purrs, My Month, export, jobs. Not product UI. */

type Call = (method: string, path: string, body?: unknown, label?: string, quiet?: boolean) => Promise<{ status: number; json: unknown }>;
type Act = (method: string, path: string, body?: unknown, label?: string) => Promise<void>;
type Member = { id: string; name: string };
type NeedItem = { text: string; action?: { method: string; path: string; body?: Record<string, unknown> } };
type Gift = { group_id: string; for_name: string; birthday: string; status: string };
type Bowl = { id: string; service: string; total_cents: number; seats: number; status: string };

const toCents = (s: string) => Math.round(Number(s) * 100);
const btn = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900";
const btn2 = "rounded border px-3 py-1.5 text-sm disabled:opacity-40";
const box = "rounded-lg border p-4 space-y-2";
const input = "rounded border px-2 py-1 text-sm";

export default function Phase2({ call, act, actAs, squadId, users }: { call: Call; act: Act; actAs: string; squadId: string; users: Member[] }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [needs, setNeeds] = useState<NeedItem[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [bowls, setBowls] = useState<Bowl[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [amount, setAmount] = useState("48");
  const [note, setNote] = useState("dinner");
  const [kind, setKind] = useState<"split" | "treat">("split");
  const [helpKind, setHelpKind] = useState<"either" | "gift" | "loan">("either");
  const [helpId, setHelpId] = useState("");
  const [lastCard, setLastCard] = useState("");
  const [asks, setAsks] = useState<{ request_id: string; from_name: string; cents: number; note: string; my_status: string; my_pledge_cents: number | null }[]>([]);
  const [partyName, setPartyName] = useState("Goa fund");
  const [goal, setGoal] = useState("500");
  const [monthly, setMonthly] = useState("20");
  const [giftLimit, setGiftLimit] = useState("30");
  const [bdayWho, setBdayWho] = useState("");
  const [service, setService] = useState("Spotify Family");
  const [total, setTotal] = useState("16.99");
  const [seats, setSeats] = useState("3");
  const [hours, setHours] = useState("0");
  const [ideas, setIdeas] = useState<{ groupId: string; list: { id: string; title: string; price_cents: number | null; source: string; votes: number; url: string | null }[] } | null>(null);

  const others = members.filter((m) => m.id !== actAs);
  const load = useCallback(async () => {
    if (!actAs || !squadId) return;
    const s = await call("GET", `squads/${squadId}`, undefined, "squad", true);
    if (s.status === 200) setMembers((s.json as { members: Member[] }).members);
    const m = await call("GET", "meows", undefined, "meows", true);
    if (m.status === 200) setNeeds((m.json as { sections: { needsYou: NeedItem[] } }).sections.needsYou);
    const g = await call("GET", "gifts", undefined, "gifts", true);
    if (g.status === 200) setGifts(g.json as Gift[]);
    const b = await call("GET", `squads/${squadId}/bowls`, undefined, "bowls", true);
    if (b.status === 200) setBowls(b.json as Bowl[]);
    const h = await call("GET", "help", undefined, "help asks", true);
    if (h.status === 200) setAsks(h.json as typeof asks);
  }, [actAs, squadId, call]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function run(method: string, path: string, body?: unknown, label?: string) {
    await act(method, path, body, label);
    await load();
  }
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const whoBoxes = (
    <div className="flex flex-wrap gap-2 text-sm">
      {others.map((m) => (
        <label key={m.id}>
          <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} /> {m.name}
        </label>
      ))}
    </div>
  );
  if (!actAs) return null;

  return (
    <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
      <section className={box + " md:col-span-2"}>
        <div className="flex items-center gap-2">
          <h2 className="font-semibold">Phase 2 · Needs you ({needs.length})</h2>
          <button className={btn2} onClick={() => void load()}>
            Refresh
          </button>
          <span className="text-xs text-neutral-500">Everything waiting for this friend (from Meows), one tap each.</span>
        </div>
        {needs.map((n, i) => (
          <div key={i} className="flex items-center justify-between gap-2 text-sm">
            <span>{n.text}</span>
            {n.action && (
              <button className={btn2} onClick={() => void run(n.action!.method, n.action!.path, n.action!.body ?? {}, n.text.slice(0, 40))}>
                Do it
              </button>
            )}
          </div>
        ))}
        {!needs.length && <p className="text-sm text-neutral-500">Nothing waiting.</p>}
      </section>

      <section className={box}>
        <h2 className="font-semibold">Yarn: &quot;I paid&quot;, then Untangle</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            $<input className={input + " w-20"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <input className={input + " w-32"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="what for" />
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="split">Split it</option>
            <option value="treat">My treat</option>
          </select>
        </div>
        <p className="text-xs text-neutral-500">For whom (the split includes you):</p>
        {whoBoxes}
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={!picked.length}
            onClick={async () => {
              const r = await call("POST", "yarn/cards", { squadId, cents: toCents(amount), note, forUserIds: picked, kind }, "I paid");
              if (r.status === 200) setLastCard((r.json as { cardId: string }).cardId);
              await load();
            }}
          >
            I paid
          </button>
          <button
            className={btn2}
            disabled={!lastCard}
            onClick={async () => {
              const r = await call("POST", `yarn/cards/${lastCard}/edit`, { cents: toCents(amount), note }, "fix my last card");
              if (r.status === 200) setLastCard((r.json as { cardId: string }).cardId);
              await load();
            }}
          >
            Fix my last card (amount, note)
          </button>
          <button className={btn2} disabled={!lastCard} onClick={() => void run("POST", `yarn/cards/${lastCard}/remove`, {}, "remove my last card")}>
            Remove my last card
          </button>
          <button className={btn2} onClick={() => void run("POST", `squads/${squadId}/untangle`, {}, "untangle")}>
            Untangle squad
          </button>
          <button className={btn2} onClick={() => void call("GET", "yarn", undefined, "my yarn")}>
            My Yarn
          </button>
          <button className={btn2} onClick={() => void call("GET", `squads/${squadId}/yarn`, undefined, "squad view (no amounts)")}>
            Squad view
          </button>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Kitty Party (squad savings)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input className={input + " w-28"} value={partyName} onChange={(e) => setPartyName(e.target.value)} />
          <label className="text-sm">
            goal $<input className={input + " w-20"} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          <button className={btn2} onClick={() => void run("POST", `squads/${squadId}/party`, { name: partyName, goalCents: toCents(goal) }, "start party")}>
            Start
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            I save $<input className={input + " w-16"} value={monthly} onChange={(e) => setMonthly(e.target.value)} /> a month
          </label>
          <button className={btn} onClick={() => void run("POST", `squads/${squadId}/party/join`, { monthlyCents: toCents(monthly) }, "join party")}>
            Join / change
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btn2} onClick={() => void call("GET", `squads/${squadId}/party`, undefined, "party (my view)")}>
            View
          </button>
          <button className={btn2} onClick={() => void run("POST", "dev/party/collect", { squadId }, "collect a month now (dev)")}>
            Collect a month now
          </button>
          <button className={btn2} onClick={() => void run("POST", `squads/${squadId}/party/withdraw`, {}, "withdraw my savings")}>
            Withdraw mine
          </button>
          <button className={btn2} onClick={() => void run("POST", `squads/${squadId}/party/stop`, {}, "stop saving")}>
            Stop
          </button>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Nine Lives (ask for help)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            $<input className={input + " w-20"} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <input className={input + " w-36"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="what for" />
          <select className={input} value={helpKind} onChange={(e) => setHelpKind(e.target.value as typeof helpKind)}>
            <option value="either">Gift or loan</option>
            <option value="gift">Gift</option>
            <option value="loan">Loan</option>
          </select>
        </div>
        <p className="text-xs text-neutral-500">Ask privately:</p>
        {whoBoxes}
        <div className="flex flex-wrap gap-2">
          <button
            className={btn}
            disabled={!picked.length}
            onClick={async () => {
              const r = await call("POST", "help", { cents: toCents(amount), note, kind: helpKind, friendIds: picked }, "ask for help");
              if (r.status === 200) setHelpId((r.json as { requestId: string }).requestId);
              await load();
            }}
          >
            Send request
          </button>
          <button className={btn2} disabled={!helpId} onClick={() => void call("GET", `help/${helpId}`, undefined, "my request")}>
            My request
          </button>
          <button className={btn2} disabled={!helpId} onClick={() => void run("POST", `help/${helpId}/accept`, {}, "accept what's pledged")}>
            Accept what&apos;s pledged
          </button>
        </div>
        <button className={btn2} disabled={!helpId} onClick={() => void run("POST", `help/${helpId}/close`, {}, "close my request")}>
          Close my request
        </button>
        <p className="text-xs text-neutral-500">Friends pledge or decline from their &quot;Needs you&quot; list. Requests asking this friend:</p>
        {asks.map((a) => (
          <div key={a.request_id} className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {a.from_name}: {a.note} (${(a.cents / 100).toFixed(2)}){a.my_pledge_cents ? ` · you pledged $${(a.my_pledge_cents / 100).toFixed(2)}` : ` · ${a.my_status}`}
            </span>
            {a.my_pledge_cents ? (
              <button className={btn2} onClick={() => void run("POST", `help/${a.request_id}/unpledge`, {}, "take my pledge back")}>
                Take my pledge back
              </button>
            ) : (
              <button className={btn2} onClick={() => void run("POST", `help/${a.request_id}/decline`, {}, "decline")}>
                Not this time
              </button>
            )}
          </div>
        ))}
      </section>

      <section className={box}>
        <h2 className="font-semibold">Catnip (group birthday gift)</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className={input} value={bdayWho} onChange={(e) => setBdayWho(e.target.value)}>
            <option value="">whose birthday? (dev)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button
            className={btn2}
            disabled={!bdayWho}
            onClick={async () => {
              await call("POST", "dev/birthday", { userId: bdayWho, inDays: 5 }, "birthday in 5 days");
              await run("POST", "dev/jobs", {}, "run jobs (radar)");
            }}
          >
            Birthday in 5 days + radar
          </button>
        </div>
        {gifts.map((g) => (
          <div key={g.group_id} className="space-y-1 text-sm">
            <div>
              Gift for <b>{g.for_name}</b> ({g.birthday}) · {g.status}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label>
                my limit $<input className={input + " w-16"} value={giftLimit} onChange={(e) => setGiftLimit(e.target.value)} />
              </label>
              <button className={btn2} onClick={() => void run("POST", `gifts/${g.group_id}/join`, { limitCents: toCents(giftLimit) }, "join gift")}>
                Join
              </button>
              <button className={btn2} onClick={() => void run("POST", `gifts/${g.group_id}/skip`, {}, "skip gift")}>
                Skip
              </button>
              <button
                className={btn2}
                onClick={async () => {
                  const r = await call("POST", `gifts/${g.group_id}/ideas`, {}, "find ideas");
                  if (r.status === 200) setIdeas({ groupId: g.group_id, list: (r.json as { ideas: { id: string; title: string; price_cents: number | null; source: string; votes: number; url: string | null }[] }).ideas });
                }}
              >
                Find ideas
              </button>
              <button className={btn2} onClick={() => void call("GET", `gifts/${g.group_id}`, undefined, "gift group")}>
                View
              </button>
            </div>
          </div>
        ))}
        {!gifts.length && <p className="text-sm text-neutral-500">No gift invites for this friend.</p>}
        {ideas?.list.map((i) => (
          <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {i.title} {i.price_cents != null ? `· $${(i.price_cents / 100).toFixed(2)}` : ""} · {i.source} · {i.votes} vote(s){" "}
              {i.url && (
                <a className="underline" href={i.url} target="_blank" rel="noreferrer">
                  link
                </a>
              )}
            </span>
            <span className="flex gap-1">
              <button className={btn2} onClick={() => void run("POST", `gifts/ideas/${i.id}/vote`, {}, "vote")}>
                Vote
              </button>
              <button className={btn2} onClick={() => void run("POST", `gifts/${ideas.groupId}/plan`, { ideaId: i.id }, "start gift plan")}>
                Choose
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className={box}>
        <h2 className="font-semibold">The Bowl (shared subscription)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input className={input + " w-32"} value={service} onChange={(e) => setService(e.target.value)} />
          <label className="text-sm">
            $<input className={input + " w-16"} value={total} onChange={(e) => setTotal(e.target.value)} />/mo
          </label>
          <label className="text-sm">
            seats <input className={input + " w-10"} value={seats} onChange={(e) => setSeats(e.target.value)} />
          </label>
        </div>
        <p className="text-xs text-neutral-500">Sharing with (you pay the provider):</p>
        {whoBoxes}
        <button className={btn} disabled={!picked.length} onClick={() => void run("POST", `squads/${squadId}/bowls`, { service, totalCents: toCents(total), seats: Number(seats), memberIds: picked }, "create bowl")}>
          Create Bowl
        </button>
        {bowls.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              {b.service} · ${(b.total_cents / 100).toFixed(2)} · {b.seats} seats
            </span>
            <button className={btn2} onClick={() => void call("GET", `bowls/${b.id}`, undefined, "bowl")}>
              View
            </button>
            <button className={btn2} onClick={() => void run("POST", `dev/bowls/${b.id}/cycle`, {}, "run a month (dev)")}>
              Run a month
            </button>
            <button className={btn2} onClick={() => void run("POST", `bowls/${b.id}/leave`, {}, "leave bowl")}>
              Leave
            </button>
            <button className={btn2} onClick={() => void run("POST", `bowls/${b.id}/close`, {}, "close bowl (account holder)")}>
              Close (holder)
            </button>
          </div>
        ))}
      </section>

      <section className={box}>
        <h2 className="font-semibold">Meows, purrs, My Month, export, jobs</h2>
        <button className={btn2} onClick={() => void run("POST", `squads/${squadId}/leave`, {}, "leave this squad")}>
          Leave this squad
        </button>
        <div className="flex flex-wrap gap-2">
          {[
            ["meows", "Meows"],
            ["alerts", "Alerts"],
            ["purrs", "My purrs"],
            [`squads/${squadId}/purrs`, "Top Cat"],
            ["month", "My Month"],
          ].map(([path, label]) => (
            <button key={path} className={btn2} onClick={() => void call("GET", path, undefined, label)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <a className="underline" href="/api/v1/export/diary.csv">
            Diary CSV
          </a>
          <a className="underline" href="/api/v1/export/month.csv">
            My Month CSV
          </a>
          <button className={btn2} onClick={() => void call("POST", "calendar/token", {}, "calendar link")}>
            Calendar link
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label>
            Run all jobs as if <input className={input + " w-14"} value={hours} onChange={(e) => setHours(e.target.value)} /> hours later
          </label>
          <button className={btn2} onClick={() => void run("POST", "dev/jobs", { hoursAhead: Number(hours) }, "run jobs")}>
            Run jobs
          </button>
        </div>
      </section>
    </div>
  );
}
