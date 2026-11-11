"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, money, shortDay, toCents, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { PlusSheets, type PlusMode } from "@/components/app/plus";
import { TopBack, Bar, Btn, Card, Chip, Field, H2, Paper, Scene, Sheet, Soft, Title, Waiting } from "@/components/app/ui";

/** Nine Lives (PRD §B12): ask friends for help, or help a friend. Always private: never in a squad. */

type Ask = { request_id: string; from_name: string; cents: number; note: string; my_status: string; my_pledge_cents: number | null };
type Mine = { id: string; cents: number; note: string; kind: string; status: string; received_cents: number | null; needed_by: string | null; pledgedCents: number; helpers: number };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

export default function Page() {
  return (
    <Suspense>
      <Lives />
    </Suspense>
  );
}

function Lives() {
  const params = useSearchParams();
  const { act } = useMoments();
  const { data: asks } = useData<Ask[]>("help");
  const { data: mine } = useData<Mine[]>("help/mine");
  const { data: me } = useData<Me>("me");
  const [plus, setPlus] = useState<PlusMode>(params.get("ask") ? "help" : null);
  const [chosen, setChosen] = useState<Ask | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const opened = dismissed ? null : (asks?.find((a) => a.request_id === params.get("open")) ?? null);
  const pledge = chosen ?? opened;
  const setPledge = (a: Ask | null) => {
    setChosen(a);
    if (!a) setDismissed(true);
  };

  const live = (mine ?? []).filter((r) => r.status === "open");
  const past = (mine ?? []).filter((r) => r.status !== "open");

  return (
    <>
      <TopBack href="/kitten" />
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-4">
            <div className="h-10" />
            <Title>Nine Lives</Title>
            <Soft className="mt-1 !text-ink">Friends helping friends, quietly.</Soft>
          </div>
          <LiveKitten look={me?.kitten?.look} mood="happy" size={116} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-3">
        {(!asks || !mine) && <Waiting />}

        {asks && asks.length > 0 && <H2>A friend could use a hand</H2>}
        {asks?.map((a, i) => (
          <Card key={a.request_id} delay={i * 50}>
            <p className="text-[15px] font-extrabold">
              {a.from_name} needs {money(a.cents)}
            </p>
            <Soft>{a.note}</Soft>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {a.my_pledge_cents ? (
                <>
                  <span className="self-center text-[14px] font-bold">You pledged {money(a.my_pledge_cents)}</span>
                  <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `help/${a.request_id}/unpledge`), { done: "Taken back." })}>
                    Take it back
                  </Btn>
                </>
              ) : (
                <>
                  <Btn small onClick={() => setPledge(a)}>
                    Help
                  </Btn>
                  {a.my_status !== "declined" && (
                    <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `help/${a.request_id}/decline`), { done: "They won't be told." })}>
                      Not this time
                    </Btn>
                  )}
                </>
              )}
            </div>
          </Card>
        ))}

        {live.length > 0 && <H2 className="pt-1">What you asked for</H2>}
        {live.map((r) => (
          <Card key={r.id}>
            <p className="text-[15px] font-extrabold">{r.note}</p>
            <Soft>
              {money(r.pledgedCents)} of {money(r.cents)} from {r.helpers} {r.helpers === 1 ? "friend" : "friends"}
              {r.needed_by ? `, by ${shortDay(r.needed_by)}` : ""}
            </Soft>
            <div className="mt-2">
              <Bar pct={(r.pledgedCents / r.cents) * 100} kind="leaf" />
            </div>
            <div className="mt-2.5 flex gap-2">
              <Btn small disabled={!r.pledgedCents} onClick={() => void act("helping", () => api("POST", `help/${r.id}/accept`), { working: "Gathering it up...", done: "It's on its way to you." })}>
                Accept what&apos;s in
              </Btn>
              <Btn small kind="plain" onClick={() => void act("released", () => api("POST", `help/${r.id}/close`), { done: "Closed. Every pledge went back." })}>
                Close
              </Btn>
            </div>
          </Card>
        ))}

        {past.length > 0 && <H2 className="pt-1">Before</H2>}
        {past.map((r) => (
          <div key={r.id} className="rounded-2xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]">
            <p className="text-[15px] font-bold">{r.note}</p>
            <Soft>{r.received_cents ? `You received ${money(r.received_cents)}` : "Closed"}</Soft>
          </div>
        ))}

        {asks && mine && !asks.length && !mine.length && (
          <Card className="text-center">
            <p className="font-serif text-[20px] font-bold">Nobody needs a hand right now.</p>
            <Soft className="mt-1">If you ever do, it goes only to the friends you pick.</Soft>
          </Card>
        )}
        <Btn kind="plain" onClick={() => setPlus("help")}>
          Ask friends for help
        </Btn>
      </Paper>
      <PlusSheets mode={plus} setMode={setPlus} />
      {pledge && <PledgeSheet ask={pledge} onClose={() => setPledge(null)} />}
    </>
  );
}

function PledgeSheet({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const { act } = useMoments();
  const { data } = useData<{ request: { kind: string }; mine?: { suggested_cents: number } }>(`help/${ask.request_id}`);
  const [typed, setAmount] = useState<string | null>(null);
  const [picked, setLoan] = useState<boolean | null>(null);
  const kind = data?.request.kind ?? "either";
  const amount = typed ?? (data?.mine?.suggested_cents ? String(data.mine.suggested_cents / 100) : "");
  const loan = picked ?? kind === "loan";
  const cents = toCents(amount);
  return (
    <Sheet title={`Help ${ask.from_name}`} onClose={onClose}>
      <Soft>{ask.note}</Soft>
      <div className="mt-3">
        <Field label="How much" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {kind === "either" && (
        <div className="mt-3 flex gap-1.5">
          <Chip on={!loan} onClick={() => setLoan(false)}>
            A gift
          </Chip>
          <Chip on={loan} onClick={() => setLoan(true)}>
            A loan
          </Chip>
        </div>
      )}
      <Soft className="mt-3">It&apos;s set aside, and only moves if {ask.from_name} accepts. Nobody else sees who gave.</Soft>
      <Btn
        className="mt-3"
        disabled={!cents}
        onClick={() => {
          onClose();
          void act("helping", () => api("POST", `help/${ask.request_id}/pledge`, { cents, asLoan: loan }), { done: "That means a lot." });
        }}
      >
        Pledge {money(cents)}
      </Btn>
    </Sheet>
  );
}
