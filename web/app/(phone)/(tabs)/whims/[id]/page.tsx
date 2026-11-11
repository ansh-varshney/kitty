"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, dayTime, money, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { NeedCard, type Item } from "@/components/app/items";
import { TopBack, Btn, Card, H2, Note, Paper, Scene, Soft, Title, Waiting } from "@/components/app/ui";

/** A whim (PRD §B6, §B7): what's being decided, your answer, and the kittens working it out. The chat is fixed: nobody can type here. */

type Talk = { id: number; text: string; at: string; owner: string; kitten: string; look: Record<string, unknown> | null; isMine: boolean };
type View = {
  whim: { id: string; what: string; place: string | null; startsAt: string | null; whenText: string | null; priceCents: number; priceMode: string; needAtLeast: number; decideBy: string | null; status: string; squadId: string; withFriend: string | null; useSavings: boolean; shareCents: number };
  mine: boolean;
  counts: { yes: number; total: number };
  cards: Item[];
  waitingOnHost: boolean;
  planId: string | null;
  talk: Talk[];
};

const STATE: Record<string, string> = { floating: "Deciding", plan: "It's a plan", faded: "Didn't happen", withdrawn: "Taken back" };

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { act } = useMoments();
  const { data, error } = useData<View>(`whims/${id}`);
  if (error) return <div className="p-8 text-center text-[15px]">{error.message}</div>;
  if (!data) return <Waiting />;
  const { whim, counts, cards, talk } = data;
  const home = whim.withFriend ? `/chat/${whim.withFriend}` : `/squads/${whim.squadId}?tab=plans`;
  const floating = whim.status === "floating";

  return (
    <>
      <TopBack href={home} />
      <Scene kind="tall" className="!pb-10">
        <div className="flex h-8 items-center gap-1 pl-11">
          <span className="rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold">{STATE[whim.status] ?? whim.status}</span>
        </div>
        <Title className="mt-2">{whim.what}</Title>
        <p className="mt-1 text-[14px] font-semibold">{[whim.startsAt ? dayTime(whim.startsAt) : whim.whenText, whim.place].filter(Boolean).join(" · ")}</p>
      </Scene>

      <Paper className="space-y-3">
        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[24px] font-extrabold">{money(whim.priceCents)}</p>
            <Soft>{whim.priceMode === "total" ? "in total" : "each"}</Soft>
          </div>
          <Soft className="mt-0.5">{whim.priceMode === "total" ? `About ${money(whim.shareCents)} each, less if more people join.` : "Everyone pays this."}</Soft>
          <p className="mt-3 text-[13px] font-bold">
            {counts.yes + 1} of {counts.total + 1} said yes, needs {whim.needAtLeast}
          </p>
          {floating && whim.decideBy && <Soft className="mt-1">Answer and pay by {dayTime(whim.decideBy)}.</Soft>}
          {whim.useSavings && <Soft className="mt-1">Kitty Party savings pay first.</Soft>}
        </Card>

        {data.waitingOnHost && <Note kind="honey">Your kitten is talking to the host&apos;s kitten. You&apos;ll get a card when there&apos;s an answer.</Note>}
        {cards.map((c) => (
          <NeedCard key={c.key} item={{ ...c, whim: undefined }} />
        ))}

        {data.planId && (
          <Link href={`/plans/${data.planId}`} className="block">
            <Btn>Open the plan</Btn>
          </Link>
        )}

        <Card delay={50}>
          <H2>The kittens&apos; chat</H2>
          {!talk.length && <Soft className="mt-1">Nobody has needed to negotiate this one.</Soft>}
          <div className="mt-2 space-y-2.5">
            {talk.map((t) => (
              <div key={t.id} className="pop-in flex items-start gap-2">
                <LiveKitten look={t.look ?? undefined} view="head" size={34} tappable={false} className="shrink-0" />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-inset px-3 py-2">
                  <p className="text-[12px] font-extrabold text-soft">
                    {t.kitten} ({t.owner})
                  </p>
                  <p className="text-[15px] leading-[21px]">{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {data.mine && floating && (
          <Btn
            small
            kind="plain"
            onClick={async () => {
              const r = await act("released", () => api("POST", `whims/${whim.id}/withdraw`), { done: "Taken back." });
              if (r) router.replace(home);
            }}
          >
            Take it back
          </Btn>
        )}
      </Paper>
    </>
  );
}
