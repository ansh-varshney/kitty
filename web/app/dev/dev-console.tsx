"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type StepResult = { ok: boolean; skipped?: boolean; summary: string; data?: unknown; needsYou?: { label: string; url: string } };
type StepInfo = { name: string; title: string; auto: boolean; latest: { ok: boolean; result: StepResult; created_at: string } | null };
type Webhook = { event_type: string; verified: boolean; received_at: string };

const KEY_STORAGE = "kitty-dev-key";

function readKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export default function DevConsole() {
  const params = useSearchParams();
  const [key, setKey] = useState("");
  const [steps, setSteps] = useState<StepInfo[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [results, setResults] = useState<Record<string, StepResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (k: string) => {
    const res = await fetch("/api/dev/steps", { headers: { "x-dev-key": k } });
    if (res.status === 401) {
      setError("Enter the dev key (DEV_CONSOLE_KEY) to use the console.");
      return;
    }
    setError(null);
    const json = (await res.json()) as { steps: StepInfo[]; webhooks: Webhook[] };
    setSteps(json.steps);
    setWebhooks(json.webhooks);
  }, []);

  useEffect(() => {
    const k = readKey();
    setKey(k);
    void load(k);
  }, [load]);

  async function run(name: string) {
    setRunning(name);
    try {
      const res = await fetch(`/api/dev/${name}`, { method: "POST", headers: { "x-dev-key": key } });
      const json = (await res.json()) as StepResult;
      setResults((r) => ({ ...r, [name]: json }));
    } finally {
      setRunning(null);
      void load(key);
    }
  }

  function saveKey(k: string) {
    setKey(k);
    try {
      localStorage.setItem(KEY_STORAGE, k);
    } catch {
      /* ignore */
    }
    void load(k);
  }

  const done = params.get("done");

  return (
    <div className="mt-6 space-y-6">
      <label className="block text-sm">
        Dev key{" "}
        <input
          className="ml-2 rounded border px-2 py-1"
          type="password"
          value={key}
          onChange={(e) => saveKey(e.target.value)}
          placeholder="only needed on the hosted URL"
        />
      </label>
      {error && <p className="rounded bg-amber-100 p-3 text-sm">{error}</p>}
      {done && <p className="rounded bg-emerald-100 p-3 text-sm">Back from PayPal: see “{done}” below.</p>}

      <ol className="space-y-3">
        {steps.map((s) => {
          const r = results[s.name] ?? s.latest?.result;
          return (
            <li key={s.name} className="rounded border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-xs text-neutral-500">{s.auto ? "automatic" : "needs you"} · step “{s.name}”</p>
                </div>
                <button
                  className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  disabled={running !== null}
                  onClick={() => run(s.name)}
                >
                  {running === s.name ? "Running…" : "Run"}
                </button>
              </div>
              {r && (
                <div className="mt-2 text-sm">
                  <p>
                    <span className={r.skipped ? "text-neutral-500" : r.ok ? "text-emerald-700" : "text-red-700"}>
                      {r.skipped ? "SKIPPED" : r.ok ? "PASS" : "FAIL"}
                    </span>{" "}
                    · {r.summary}
                  </p>
                  {r.needsYou && (
                    <a className="mt-1 inline-block text-indigo-700 underline" href={r.needsYou.url}>
                      {r.needsYou.label} →
                    </a>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <ReturnResults steps={["walletHoldApproved", "subscriptionApproved", "loginReturned"]} devKey={key} />

      <section>
        <h2 className="font-medium">Latest PayPal webhooks</h2>
        {webhooks.length === 0 ? (
          <p className="text-sm text-neutral-500">None yet (webhooks only arrive on the hosted URL).</p>
        ) : (
          <ul className="text-sm">
            {webhooks.map((w, i) => (
              <li key={i}>
                {w.event_type} · {w.verified ? "verified" : "NOT verified"} · {new Date(w.received_at).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ReturnResults({ steps, devKey }: { steps: string[]; devKey: string }) {
  const [rows, setRows] = useState<{ step: string; ok: boolean; summary: string }[]>([]);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/dev/returns", { headers: { "x-dev-key": devKey } });
      if (res.ok) setRows((await res.json()) as { step: string; ok: boolean; summary: string }[]);
    })();
  }, [devKey]);
  return (
    <section>
      <h2 className="font-medium">Results after coming back from PayPal</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing yet. Use the “needs you” links above.</p>
      ) : (
        <ul className="text-sm">
          {rows
            .filter((r) => steps.includes(r.step))
            .map((r, i) => (
              <li key={i}>
                <span className={r.ok ? "text-emerald-700" : "text-red-700"}>{r.ok ? "PASS" : "FAIL"}</span> · {r.step}: {r.summary}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
