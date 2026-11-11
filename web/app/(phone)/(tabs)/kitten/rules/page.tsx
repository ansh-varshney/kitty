"use client";

import { useState } from "react";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { TopBack, Btn, Card, Field, H2, Icon, Note, Paper, Scene, Soft, Stepper, Title, Toggle, Waiting } from "@/components/app/ui";

/** House Rules (PRD §B3): what your kitten may do on its own. */

type Rule = { id: string; type: string; squadId: string | null; params: Record<string, unknown>; text: string; active: boolean };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

export default function Page() {
  const { data } = useData<Rule[]>("rules");
  const { data: me } = useData<Me>("me");
  const { act, toast } = useMoments();
  const [editFun, setFun] = useState<number | null>(null);
  const [editHand, setHand] = useState<number | null>(null);
  const [editHelp, setHelp] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [poke, setPoke] = useState(0);

  const rule = (t: string) => data?.find((r) => r.type === t && !r.squadId && r.active);
  const cents = (r?: Rule) => Math.round(Number(r?.params.cents ?? 0) / 100);
  const share = rule("R4")?.params as { availability?: boolean; attendance?: boolean; interests?: boolean } | undefined;

  const fun = data ? (editFun ?? cents(rule("R1"))) : null;
  const hand = data ? (editHand ?? cents(rule("R2"))) : null;
  const help = data ? (editHelp ?? cents(rule("R3"))) : null;
  const dirty = data && (fun !== cents(rule("R1")) || hand !== cents(rule("R2")) || help !== cents(rule("R3")));
  const others = (data ?? []).filter((r) => !["R1", "R2", "R3", "R4"].includes(r.type) && !r.squadId && r.active);
  const bump = () => setPoke((p) => p + 1);

  const setSharing = (k: "availability" | "attendance" | "interests") => {
    const next = { availability: share?.availability !== false, attendance: share?.attendance !== false, interests: share?.interests !== false };
    next[k] = !next[k];
    void api("POST", "rules/share", next)
      .then(() => {
        bump();
        toast("Changed.");
      })
      .catch(() => toast("That didn't save."));
  };

  const add = async () => {
    const t = text.trim();
    setText("");
    await act<{ plain?: string }>("thinking", () => api("POST", "rules", { text: t }), { working: "Learning that...", done: "Got it." });
  };

  return (
    <>
      <TopBack href="/kitten" />
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-4">
            <div className="h-10" />
            <Title>House Rules</Title>
            <Soft className="mt-1 !text-ink">What {me?.kitten?.name ?? "your kitten"} may do alone.</Soft>
          </div>
          <LiveKitten look={me?.kitten?.look} mood="neutral" size={116} reactKey={poke} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-3">
        {!data && <Waiting />}
        {data && fun !== null && hand !== null && help !== null && (
          <>
            <Basic title="Fun budget" sub="The most you want to spend with friends in a month. Your kitten warns you before you go over.">
              <Stepper value={fun} min={10} max={5000} onChange={(n) => (setFun(n), bump())} format={(n) => `$${n}`} />
            </Basic>
            <Basic title="Free hand" sub="What your kitten can pay from the Treat Jar without asking. When you tap, the jar pays any amount.">
              <Stepper value={hand} min={0} max={1000} onChange={(n) => (setHand(n), bump())} format={(n) => `$${n}`} />
            </Basic>
            <Basic title="Help amount" sub="When a friend needs money, your kitten suggests chipping in this much. You always decide.">
              <Stepper value={help} min={0} max={1000} onChange={(n) => (setHelp(n), bump())} format={(n) => `$${n}`} />
            </Basic>
            {hand > fun && <Note kind="honey">Free hand can&apos;t be more than your fun budget.</Note>}
            {dirty && (
              <Btn disabled={hand > fun} onClick={() => void act("thinking", () => api("POST", "rules/basic", { funBudgetCents: fun * 100, freeHandCents: hand * 100, helpCents: help * 100 }), { done: "New rules, got it." })}>
                Save
              </Btn>
            )}

            <H2 className="pt-2">What friends&apos; kittens may hear</H2>
            <Card className="space-y-3">
              {(
                [
                  ["availability", "If I'm free"],
                  ["attendance", "What I'm going to"],
                  ["interests", "What I like"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setSharing(k)}>
                  <span className="text-[15px] font-semibold">{label}</span>
                  <Toggle on={share?.[k] !== false} />
                </button>
              ))}
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold">Anything about my money</span>
                <span className="text-[13px] font-extrabold text-soft">Never</span>
              </div>
            </Card>

            <H2 className="pt-2">Your own rules</H2>
            {others.map((r) => (
              <div key={r.id} className="slide-up flex items-center justify-between gap-2 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_0_var(--color-line)]">
                <p className="text-[14px]">{r.text}</p>
                <button type="button" aria-label="Remove" onClick={() => void act("released", () => api("DELETE", `rules/${r.id}`), { done: "Removed." })}>
                  <Icon i="close" size={16} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <Field placeholder="Say it in your own words" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} />
              <Btn small disabled={text.trim().length < 3} onClick={() => void add()}>
                Add
              </Btn>
            </div>
          </>
        )}
      </Paper>
    </>
  );
}

const Basic = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 shadow-[0_2px_0_var(--color-line)]">
    <div className="min-w-0">
      <p className="text-[15px] font-extrabold">{title}</p>
      <Soft>{sub}</Soft>
    </div>
    {children}
  </div>
);
