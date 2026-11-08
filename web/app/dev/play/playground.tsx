"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Phase2 from "./phase2";

/** A plain test bench for the /api/v1 backend. Not product UI. */

type DevUser = { id: string; name: string; is_demo: boolean; kitten: string | null };
type Me = {
  user: { id: string; name: string };
  kitten: { name: string; breed: string } | null;
  squads: { id: string; name: string; kind: string; invite_code: string }[];
  jar: { availableCents: number; heldCents: number };
  month: { spentCents: number; committedCents: number; funBudgetCents: number | null };
  rules: { type: string; text: string }[];
};
type Answer = { id: string; whim_id: string; what: string; prepared: string; prepared_reason: string; shareText: string; need_at_least: number };
type PlanView = {
  plan: { needAtLeast: number; splitMode: string; priceCents: number; pounceRule: string };
  members: { id: string; name: string; status: string }[];
  pot: { inCount: number };
  share: { text: string } | null;
};
type PlanItem = { id: string; title: string; status: string; my_status: string | null; price_cents: number; squad_name: string };
type Live = { id: number; type: string; mine: boolean; payload?: Record<string, unknown>; public?: Record<string, unknown> };

const KEY_STORAGE = "kitty-dev-key";
const $ = (c: number | null | undefined) => (c == null ? "-" : `$${(c / 100).toFixed(2)}`);
const toCents = (s: string) => Math.round(Number(s) * 100);

function readKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export default function Playground() {
  const [key, setKey] = useState("");
  const [users, setUsers] = useState<DevUser[]>([]);
  const [actAs, setActAs] = useState("");
  const [me, setMe] = useState<Me | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [plan, setPlan] = useState<{ id: string; view: unknown } | null>(null);
  const [out, setOut] = useState<{ label: string; status: number; body: unknown } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<Live[]>([]);
  const [routes, setRoutes] = useState<string[]>([]);

  const [whimText, setWhimText] = useState("Bowling Friday 7pm, about $20 each");
  const [whimSquad, setWhimSquad] = useState("");
  const [whimImage, setWhimImage] = useState<{ b64: string; type: string; name: string } | null>(null);
  const [amount, setAmount] = useState("30");
  const [overBudget, setOverBudget] = useState(false);
  const [rule, setRule] = useState<"everyone" | "at_least" | "host">("at_least");
  const [need, setNeed] = useState("2");
  const [total, setTotal] = useState("60");
  const [receiptId, setReceiptId] = useState("");
  const [receiptTotal, setReceiptTotal] = useState("");
  const [whimNeed, setWhimNeed] = useState("");
  const [lastWhim, setLastWhim] = useState("");
  const [splitMode, setSplitMode] = useState<"equal" | "custom" | "weights">("equal");
  const [splitWho, setSplitWho] = useState("");
  const [splitValue, setSplitValue] = useState("");
  const [hours, setHours] = useState("49");
  const [chat, setChat] = useState("How much have I spent with friends this month?");
  const [raw, setRaw] = useState({ method: "GET", path: "me", body: "" });
  const esRef = useRef<EventSource | null>(null);
  const keyRef = useRef("");

  const call = useCallback(
    async (method: string, path: string, body?: unknown, label?: string, quiet = false) => {
      setBusy(label ?? path);
      try {
        const res = await fetch(`/api/v1/${path}`, {
          method,
          headers: { "content-type": "application/json", "x-dev-key": keyRef.current },
          body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
        });
        const json = await res.json().catch(() => ({}));
        // Background refreshes stay quiet so "Last response" keeps showing what you just did.
        if (!quiet || res.status >= 400) setOut({ label: label ?? `${method} ${path}`, status: res.status, body: json });
        return { status: res.status, json };
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    const m = await call("GET", "me", undefined, "me", true);
    if (m.status !== 200) return;
    setMe(m.json as Me);
    const s = (m.json as Me).squads;
    setWhimSquad((cur) => cur || s[0]?.id || "");
    const a = await call("GET", "answers", undefined, "answers", true);
    if (a.status === 200) setAnswers(a.json as Answer[]);
    const p = await call("GET", "plans", undefined, "plans", true);
    if (p.status === 200) setPlans(p.json as PlanItem[]);
  }, [call]);

  const loadUsers = useCallback(async () => {
    const r = await call("GET", "dev/users", undefined, "users", true);
    if (r.status === 200) setUsers(r.json as DevUser[]);
    const rl = await call("GET", "dev/routes", undefined, "routes", true);
    if (rl.status === 200) setRoutes(rl.json as string[]);
  }, [call]);

  useEffect(() => {
    keyRef.current = readKey();
    void Promise.resolve().then(() => {
      setKey(keyRef.current);
      return loadUsers();
    });
  }, [loadUsers]);

  async function become(id: string) {
    setActAs(id);
    setPlan(null);
    setLive([]);
    await call("POST", "dev/login-as", { userId: id }, "log in as");
    esRef.current?.close();
    const es = new EventSource("/api/v1/stream");
    es.addEventListener("kitty", (e) => setLive((l) => [JSON.parse((e as MessageEvent).data) as Live, ...l].slice(0, 40)));
    esRef.current = es;
    await refresh();
  }
  useEffect(() => () => esRef.current?.close(), []);

  async function openPlan(id: string, quiet = false) {
    const r = await call("GET", `plans/${id}`, undefined, "plan", quiet);
    if (r.status !== 200) return;
    setPlan({ id, view: r.json });
    // Host controls start from THIS plan's values, so "Save" never changes something by accident.
    if (!quiet) {
      const v = r.json as PlanView;
      setTotal(String(v.plan.priceCents / 100));
      setRule(v.plan.pounceRule as "everyone" | "at_least" | "host");
      setNeed(String(v.plan.needAtLeast));
    }
  }
  async function act(method: string, path: string, body?: unknown, label?: string) {
    await call(method, path, body, label);
    await refresh();
    if (plan) await openPlan(plan.id, true);
  }

  function onFile(f: File | undefined) {
    if (!f) return setWhimImage(null);
    const r = new FileReader();
    r.onload = () => setWhimImage({ b64: String(r.result).split(",")[1], type: f.type, name: f.name });
    r.readAsDataURL(f);
  }

  const btn = "rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40";
  const btn2 = "rounded border px-3 py-1.5 text-sm disabled:opacity-40";
  const box = "rounded-lg border p-4 space-y-3";
  const input = "rounded border px-2 py-1 text-sm";

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <section className={box + " md:col-span-2"}>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Dev key{" "}
            <input
              className={input}
              type="password"
              value={key}
              placeholder="only on the hosted URL"
              onChange={(e) => {
                setKey(e.target.value);
                keyRef.current = e.target.value;
                try {
                  localStorage.setItem(KEY_STORAGE, e.target.value);
                } catch {}
              }}
            />
          </label>
          <button className={btn2} onClick={() => void loadUsers()}>
            Reload users
          </button>
          <button className={btn} disabled={!!busy} onClick={async () => (await call("POST", "dev/seed", {}, "seed demo world"), await loadUsers())}>
            Seed demo world
          </button>
          <span className="text-sm text-neutral-500">{busy ? `Working: ${busy}…` : ""}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {users
            .filter((u) => u.is_demo)
            .map((u) => (
              <button key={u.id} className={u.id === actAs ? btn : btn2} onClick={() => void become(u.id)}>
                {u.name} ({u.kitten})
              </button>
            ))}
          {!users.length && <span className="text-sm text-neutral-500">No users yet: press Seed demo world (6 real sandbox top-ups).</span>}
        </div>
        {me && (
          <p className="text-sm">
            <b>{me.user.name}</b> with {me.kitten?.name} ({me.kitten?.breed}) · Treat Jar {$(me.jar.availableCents)} free, {$(me.jar.heldCents)} set aside · Month:{" "}
            {$(me.month.spentCents)} spent, {$(me.month.committedCents)} committed of {$(me.month.funBudgetCents)} fun budget · Squads:{" "}
            {me.squads.map((s) => `${s.name}${s.kind === "mini" ? " (mini)" : ""}`).join(", ")}
          </p>
        )}
      </section>

      <section className={box}>
        <h2 className="font-semibold">1. Float a whim</h2>
        <select className={input} value={whimSquad} onChange={(e) => setWhimSquad(e.target.value)}>
          {me?.squads.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <textarea className={input + " w-full"} rows={2} value={whimText} onChange={(e) => setWhimText(e.target.value)} />
        <label className="block text-sm">
          Need at least <input className={input + " w-14"} value={whimNeed} placeholder="auto" onChange={(e) => setWhimNeed(e.target.value)} /> people (blank = half the group)
        </label>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="text-sm" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          className={btn}
          disabled={!actAs || !!busy}
          onClick={async () => {
            const needAtLeast = whimNeed.trim() ? Number(whimNeed) : undefined;
            const r = await call(
              "POST",
              "whims",
              whimImage
                ? { squadId: whimSquad, imageBase64: whimImage.b64, mimeType: whimImage.type, text: whimText || undefined, needAtLeast }
                : { squadId: whimSquad, text: whimText, needAtLeast },
              "float whim",
            );
            const id = (r.json as { whimId?: string }).whimId;
            if (id) setLastWhim(id);
            await refresh();
          }}
        >
          Float it {whimImage ? `(with ${whimImage.name})` : ""}
        </button>
        <button className={btn2} disabled={!lastWhim || !!busy} onClick={() => void act("POST", `whims/${lastWhim}/withdraw`, {}, "withdraw my whim")}>
          Withdraw my last whim
        </button>
      </section>

      <section className={box}>
        <h2 className="font-semibold">2. My kitten&apos;s prepared answers ({answers.length})</h2>
        {answers.map((a) => (
          <div key={a.id} className="text-sm">
            <b>{a.what}</b> · {a.shareText} · need at least {a.need_at_least}
            <br />
            kitten says <i>{a.prepared}</i>, &quot;{a.prepared_reason}&quot;{" "}
            {(["yes", "maybe", "no"] as const).map((x) => (
              <button key={x} className={btn2 + " ml-1 py-0.5"} onClick={() => void act("POST", "answers/confirm", { items: [{ answerId: a.id, answer: x }] }, `answer ${x}`)}>
                {x}
              </button>
            ))}
          </div>
        ))}
        {answers.length > 0 && (
          <button className={btn} onClick={() => void act("POST", "answers/confirm", { items: answers.map((a) => ({ answerId: a.id })) }, "confirm all")}>
            Looks right: confirm all
          </button>
        )}
      </section>

      <section className={box}>
        <h2 className="font-semibold">3. Plans</h2>
        {plans.map((p) => (
          <button key={p.id} className={(plan?.id === p.id ? btn : btn2) + " mr-2 mb-1"} onClick={() => void openPlan(p.id)}>
            {p.title} · {p.status} · me: {p.my_status ?? "-"} · {$(p.price_cents)}
          </button>
        ))}
        {plan && (
          <div className="space-y-2">
            <p className="rounded border-l-4 border-neutral-900 bg-neutral-50 p-2 text-sm font-medium dark:border-neutral-100 dark:bg-neutral-900">
              {(plan.view as PlanView).share?.text ?? "The host hasn't set a price yet."} · {(plan.view as PlanView).pot.inCount} in · need at least{" "}
              {(plan.view as PlanView).plan.needAtLeast} · split: {(plan.view as PlanView).plan.splitMode}
            </p>
            <div className="flex flex-wrap items-center gap-2 rounded bg-neutral-50 p-2 dark:bg-neutral-900">
              <span className="text-sm font-medium">Host:</span>
              <label className="text-sm">
                total $<input className={input + " w-20"} value={total} onChange={(e) => setTotal(e.target.value)} />
              </label>
              <select className={input} value={rule} onChange={(e) => setRule(e.target.value as typeof rule)}>
                <option value="everyone">Pounce when everyone is in</option>
                <option value="at_least">Pounce with at least N</option>
                <option value="host">Pounce when I tap</option>
              </select>
              <label className="text-sm">
                N <input className={input + " w-12"} value={need} onChange={(e) => setNeed(e.target.value)} />
              </label>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/edit`, { priceCents: toCents(total), pounceRule: rule, needAtLeast: Number(need) }, "host: save price + rule")}>
                Save
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded bg-neutral-50 p-2 dark:bg-neutral-900">
              <span className="text-sm font-medium">Host split:</span>
              <select className={input} value={splitMode} onChange={(e) => setSplitMode(e.target.value as typeof splitMode)}>
                <option value="equal">Equal</option>
                <option value="custom">Custom amount for one person</option>
                <option value="weights">Weight for one person (a couple = 2)</option>
              </select>
              {splitMode !== "equal" && (
                <>
                  <select className={input} value={splitWho} onChange={(e) => setSplitWho(e.target.value)}>
                    <option value="">who?</option>
                    {(plan.view as PlanView).members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <input className={input + " w-20"} value={splitValue} placeholder={splitMode === "custom" ? "$" : "weight"} onChange={(e) => setSplitValue(e.target.value)} />
                </>
              )}
              <button
                className={btn2}
                disabled={splitMode !== "equal" && (!splitWho || !splitValue)}
                onClick={() =>
                  void act(
                    "POST",
                    `plans/${plan.id}/split`,
                    splitMode === "equal"
                      ? { splitMode }
                      : { splitMode, members: [splitMode === "custom" ? { userId: splitWho, customCents: toCents(splitValue) } : { userId: splitWho, weight: Number(splitValue) }] },
                    "host: split",
                  )
                }
              >
                Set split
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm">
                up to $<input className={input + " w-20"} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="text-sm">
                <input type="checkbox" checked={overBudget} onChange={(e) => setOverBudget(e.target.checked)} /> ok over budget
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btn} onClick={() => void act("POST", `plans/${plan.id}/paw`, { limitCents: toCents(amount), confirmOverBudget: overBudget }, "paw in")}>
                Paw in
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/paw-up`, { accept: true }, "paw up yes")}>
                Paw up: yes
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/paw-up`, { accept: false }, "paw up no")}>
                Paw up: no
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/pounce`, {}, "Pounce (host)")}>
                Pounce (host)
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/cancel`, {}, "cancel plan (host)")}>
                Cancel plan (host)
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/respond`, { status: "out" }, "I'm out")}>
                I&apos;m out
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/tag-along`, { limitCents: toCents(amount) }, "tag along")}>
                Tag along
              </button>
              <button className={btn2} onClick={() => void act("POST", `plans/${plan.id}/negotiate`, {}, "negotiate")}>
                Kittens: find a better time
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded bg-neutral-50 p-2 dark:bg-neutral-900">
              <span className="text-sm font-medium">Booker, after booking:</span>
              <label className="text-sm">
                receipt total $<input className={input + " w-20"} value={receiptTotal} onChange={(e) => setReceiptTotal(e.target.value)} />
              </label>
              <button
                className={btn2}
                onClick={async () => {
                  const r = await call("POST", `plans/${plan.id}/receipt`, { cents: toCents(receiptTotal) }, "add receipt");
                  if (r.status === 200) setReceiptId((r.json as { receiptId: string }).receiptId);
                }}
              >
                Add receipt
              </button>
              <button className={btn2} disabled={!receiptId} onClick={() => void act("POST", `receipts/${receiptId}/confirm`, { cents: toCents(receiptTotal) }, "confirm receipt")}>
                Confirm receipt
              </button>
            </div>
            <pre className="max-h-72 overflow-auto rounded bg-neutral-100 p-2 text-xs">{JSON.stringify(plan.view, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className={box}>
        <h2 className="font-semibold">4. Time, kitten chat</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm">
            Run the timer as if <input className={input + " w-16"} value={hours} onChange={(e) => setHours(e.target.value)} /> hours from now
          </label>
          <button className={btn2} onClick={() => void act("POST", "tick", { hoursAhead: Number(hours) }, "tick")}>
            Tick
          </button>
        </div>
        <div className="flex gap-2">
          <input className={input + " flex-1"} value={chat} onChange={(e) => setChat(e.target.value)} />
          <button className={btn} disabled={!actAs} onClick={() => void act("POST", "kitten/chat", { message: chat }, "kitten chat")}>
            Ask my kitten
          </button>
        </div>
        <div className="flex gap-2">
          <button className={btn2} disabled={!actAs} onClick={() => void call("GET", "diary", undefined, "my Kitten Diary")}>
            My Kitten Diary
          </button>
          <button className={btn2} disabled={!whimSquad} onClick={() => void call("GET", `squads/${whimSquad}/feed`, undefined, "squad feed (what friends see)")}>
            Squad feed
          </button>
          <button className={btn2} disabled={!actAs} onClick={() => void call("GET", "calendar", undefined, "calendar")}>
            Calendar
          </button>
        </div>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Live (SSE stream)</h2>
        <ul className="max-h-64 space-y-1 overflow-auto text-xs">
          {live.map((e) => (
            <li key={e.id}>
              <span className={e.mine ? "font-semibold" : "text-neutral-500"}>{e.mine ? "me" : "squad"}</span> {e.type}:{" "}
              {String((e.mine ? e.payload?.text : undefined) ?? e.public?.text ?? JSON.stringify(e.mine ? e.payload : e.public))}
            </li>
          ))}
          {!live.length && <li className="text-neutral-500">Pick a friend above; their events appear here as they happen.</li>}
        </ul>
      </section>

      <section className={box}>
        <h2 className="font-semibold">Any endpoint</h2>
        <div className="flex gap-2">
          <select className={input} value={raw.method} onChange={(e) => setRaw({ ...raw, method: e.target.value })}>
            <option>GET</option>
            <option>POST</option>
            <option>DELETE</option>
          </select>
          <input className={input + " flex-1"} value={raw.path} onChange={(e) => setRaw({ ...raw, path: e.target.value })} />
          <button
            className={btn}
            onClick={() => {
              let b: unknown = {};
              try {
                b = raw.body ? JSON.parse(raw.body) : {};
              } catch {
                return setOut({ label: "body", status: 0, body: "Body is not valid JSON" });
              }
              void act(raw.method, raw.path, b);
            }}
          >
            Send
          </button>
        </div>
        <textarea className={input + " w-full font-mono"} rows={3} placeholder='{"json": "body"}' value={raw.body} onChange={(e) => setRaw({ ...raw, body: e.target.value })} />
        <details className="text-xs">
          <summary>All routes ({routes.length})</summary>
          <pre>{routes.join("\n")}</pre>
        </details>
      </section>

      <Phase2 call={call} act={act} actAs={actAs} squadId={whimSquad} users={users.filter((u) => u.is_demo).map((u) => ({ id: u.id, name: u.name }))} />

      <section className={box + " md:col-span-2"}>
        <h2 className="font-semibold">
          Last response {out && <span className={out.status < 300 ? "text-green-700" : "text-red-700"}>({out.label}: {out.status})</span>}
        </h2>
        <pre className="max-h-96 overflow-auto rounded bg-neutral-100 p-2 text-xs">{out ? JSON.stringify(out.body, null, 2) : "Nothing yet."}</pre>
      </section>
    </div>
  );
}
