"use client";

import { Suspense, useEffect, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { PROPS } from "@/components/kitten/Kitten";
import { api, refreshAll, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { NeedCard, type Item } from "@/components/app/items";
import { Btn, Card, H2, Paper, Scene, Soft, Title, Waiting } from "@/components/app/ui";

/** Home (PRD §B16, F4): what needs you, what your kitten did, and what's coming. */

type Line = { text: string };
type Meows = { hello: string; sections: { needsYou: Item[]; whatIDid: Line[]; comingUp: Line[]; yourMonth: Line[]; littleSomething: Line[] } };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

const BACK: Record<string, [string, string]> = {
  pay: ["Paid. Untangled.", "Nothing was paid."],
  jar: ["Treat Jar topped up.", "No money was taken."],
  help: ["Your pledge is in.", "Nothing was held."],
  subscription: ["You're saving now.", "Nothing was set up."],
  hold: ["Your hold is in. You're safe.", "Nothing was held."],
};
const DIDNT_FINISH = "That didn't finish. Check your PayPal before trying again.";

export default function Page() {
  return (
    <Suspense>
      <Meow />
    </Suspense>
  );
}

function Meow() {
  const { data } = useData<Meows>("meows");
  const { data: me } = useData<Me>("me");
  const params = useSearchParams();
  const { toast } = useMoments();
  const told = useRef(false);

  // Back from PayPal: say how it went.
  useEffect(() => {
    if (told.current) return;
    for (const [k, [ok, no]] of Object.entries(BACK)) {
      const v = params.get(k);
      if (v) {
        told.current = true;
        toast(v === "done" ? ok : v === "failed" ? DIDNT_FINISH : no);
      }
    }
    const c = params.get("cancelled");
    if (c && !told.current) {
      told.current = true;
      toast("Nothing changed.");
    }
  }, [params, toast]);

  const s = data?.sections;
  const needs = s?.needsYou ?? [];
  const seen = needs.map((n) => n.key).join();
  useEffect(() => {
    if (data) void api("POST", "kitten/cards/read").then(refreshAll, () => undefined);
  }, [Boolean(data), seen]); // eslint-disable-line react-hooks/exhaustive-deps -- once per set of cards
  const quiet = s && !needs.length;
  return (
    <>
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-5">
            <Soft className="!font-extrabold uppercase tracking-wider">Meows</Soft>
            <Title className="mt-1">{!s ? "..." : needs.length ? `${needs.length} thing${needs.length > 1 ? "s" : ""} need${needs.length > 1 ? "" : "s"} you.` : "All quiet."}</Title>
            {data && <Soft className="mt-1 !text-ink">{data.hello}</Soft>}
          </div>
          <LiveKitten look={me?.kitten?.look} mood={quiet ? "sleepy" : "happy"} pose={quiet ? "sleep" : "hold"} prop={quiet ? undefined : PROPS.letter} size={150} title={me?.kitten?.name} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-5">
        {!s && <Waiting />}
        {needs.length > 0 && (
          <section className="space-y-2.5">
            <H2>Needs you</H2>
            {needs.map((n, i) => (
              <NeedCard key={n.key ?? n.text + i} item={n} delay={i * 60} />
            ))}
          </section>
        )}
        {s && !needs.length && (
          <Card className="text-center">
            <p className="text-[15px]">Nothing needs you. I&apos;m napping.</p>
            <Link href="/chat" className="mt-3 block">
              <Btn kind="plain">Talk to {me?.kitten?.name ?? "your kitten"}</Btn>
            </Link>
          </Card>
        )}
        {s && <Lines title="Your month" lines={s.yourMonth} href="/month" />}
        {s && s.whatIDid.length > 0 && <Lines title="What I did" lines={s.whatIDid} href="/kitten/diary" cards />}
        {s && s.comingUp.length > 0 && <Lines title="Coming up" lines={s.comingUp} />}
        {s && (
          <Card delay={120} className="!bg-lilac-soft">
            <p className="text-[13px] font-extrabold text-soft">A little something</p>
            <p className="mt-1 text-[15px] leading-[21px]">{s.littleSomething[0]?.text}</p>
          </Card>
        )}
      </Paper>
    </>
  );
}

function Lines({ title, lines, href, cards }: { title: string; lines: Line[]; href?: string; cards?: boolean }) {
  const body = (
    <>
      <H2>{title}</H2>
      <div className={cards ? "mt-2 space-y-2" : "mt-1.5 space-y-1.5"}>
        {lines.map((l, i) => (
          <p key={i} className={`slide-up text-[15px] leading-[21px] ${cards ? "rounded-2xl bg-card px-3.5 py-2.5 text-[14px] leading-[20px] shadow-[0_2px_0_var(--color-line)]" : ""}`} style={{ ["--delay" as string]: `${i * 50}ms` }}>
            {l.text}
          </p>
        ))}
      </div>
    </>
  );
  return <section>{href ? <Link href={href}>{body}</Link> : body}</section>;
}
