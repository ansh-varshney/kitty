"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { PROPS } from "@/components/kitten/Kitten";
import { api, money, shortDay, toCents, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { TopBack, Btn, Card, Field, H2, Note, Paper, Scene, Sheet, Soft, Title, Waiting } from "@/components/app/ui";

/** Catnip (PRD §B14): a secret group gift. The birthday friend never sees any of this. */

type Idea = { id: string; title: string; price_cents: number | null; url: string | null; image_url: string | null; brand: string | null; votes: number; iVoted: boolean };
type Gift = { group: { id: string; for?: string; birthday: string; squadId?: string; planId?: string | null }; joined: boolean; joinedNames?: string[]; budgetCents?: number; myLimitCents?: number | null; ideas?: Idea[] };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { act } = useMoments();
  const { data, error } = useData<Gift>(`gifts/${id}`);
  const { data: me } = useData<Me>("me");
  const [sheet, setSheet] = useState<null | "limit" | "link" | "pick">(null);
  const [limit, setLimit] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [pick, setPick] = useState<Idea | null>(null);

  if (error) return <div className="p-8 text-center text-[15px]">{error.message}</div>;
  if (!data) return <Waiting />;

  const start = async () => {
    if (!pick) return;
    setSheet(null);
    const r = await act<{ planId?: string; id?: string }>("catnip", () => api("POST", `gifts/${id}/plan`, { ideaId: pick.id }), { done: "It's a plan." });
    const planId = r?.planId ?? r?.id;
    if (planId) router.push(`/plans/${planId}`);
  };

  return (
    <>
      <TopBack href="/squads" />
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-4">
            <div className="h-10" />
            <Title>A gift for {data.group.for ?? "a friend"}</Title>
            <Soft className="mt-1 !text-ink">Birthday {shortDay(data.group.birthday)}. Shhh.</Soft>
          </div>
          <LiveKitten look={me?.kitten?.look} mood="happy" pose="hold" prop={PROPS.gift} size={120} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-3">
        {!data.joined && (
          <Card className="text-center">
            <p className="font-serif text-[20px] font-bold">Want in?</p>
            <Soft className="mt-1">Join to see the ideas and chip in.</Soft>
            <div className="mt-3 space-y-2">
              <Btn onClick={() => void act("catnip", () => api("POST", `gifts/${id}/join`), { done: "You're in on it." })}>Join the gift</Btn>
              <Btn kind="plain" onClick={() => void act("released", () => api("POST", `gifts/${id}/skip`), { done: "No problem." })}>
                Skip this one
              </Btn>
            </div>
          </Card>
        )}
        {data.joined && (
          <>
            <Card>
              <p className="text-[15px] font-bold">{data.joinedNames?.join(", ")}</p>
              <Soft className="mt-0.5">Together up to {money(data.budgetCents ?? 0)}. Yours: {data.myLimitCents ? money(data.myLimitCents) : "not set"}.</Soft>
              <Btn small kind="plain" className="mt-2" onClick={() => setSheet("limit")}>
                Set my limit
              </Btn>
            </Card>
            {data.group.planId && (
              <Link href={`/plans/${data.group.planId}`} className="block">
                <Btn>Open the gift plan</Btn>
              </Link>
            )}
            <div className="flex items-center justify-between pt-1">
              <H2>Ideas</H2>
              <Btn small kind="plain" onClick={() => void act("catnip", () => api("POST", `gifts/${id}/ideas`), { working: "Sniffing around...", done: "Found some." })}>
                Find ideas
              </Btn>
            </div>
            {!data.ideas?.length && <Soft>No ideas yet. Your kitten can find some, or add your own.</Soft>}
            {data.ideas?.map((g, i) => (
              <Card key={g.id} delay={i * 40} className="!p-3">
                <div className="flex gap-3">
                  {g.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={g.image_url} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-extrabold leading-5">{g.title}</p>
                    <Soft>{[g.brand, g.price_cents ? money(g.price_cents) : null].filter(Boolean).join(" · ")}</Soft>
                    {g.url && (
                      <a href={g.url} target="_blank" rel="noreferrer" className="text-[13px] font-bold underline">
                        See it
                      </a>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <Btn small kind={g.iVoted ? "ink" : "plain"} onClick={() => void act("catnip", () => api("POST", `gifts/ideas/${g.id}/vote`), { working: "Counting paws...", done: "Noted.", minMs: 500 })}>
                    {g.votes} {g.votes === 1 ? "vote" : "votes"}
                  </Btn>
                  {!data.group.planId && (
                    <Btn
                      small
                      onClick={() => {
                        setPick(g);
                        setSheet("pick");
                      }}
                    >
                      Pick this
                    </Btn>
                  )}
                </div>
              </Card>
            ))}
            <Btn kind="plain" onClick={() => setSheet("link")}>
              Add my own idea
            </Btn>
            <Note>{data.group.for} can&apos;t see this.</Note>
          </>
        )}
      </Paper>

      {sheet === "limit" && (
        <Sheet title="Your limit" onClose={() => setSheet(null)}>
          <Field label="The most you'd put in" inputMode="decimal" autoFocus value={limit} onChange={(e) => setLimit(e.target.value)} />
          <Btn
            className="mt-3"
            disabled={!toCents(limit)}
            onClick={() => {
              setSheet(null);
              void act("catnip", () => api("POST", `gifts/${id}/limit`, { limitCents: toCents(limit) }), { done: "Noted." });
            }}
          >
            Save
          </Btn>
        </Sheet>
      )}
      {sheet === "link" && (
        <Sheet title="Add an idea" onClose={() => setSheet(null)}>
          <div className="space-y-3">
            <Field label="What" autoFocus maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Field label="Link (optional)" type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
            <Field label="Price (optional)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Btn
              disabled={!title.trim()}
              onClick={() => {
                setSheet(null);
                void act("catnip", () => api("POST", `gifts/${id}/links`, { title: title.trim(), url: url.trim() || undefined, priceCents: toCents(price) || undefined }), { done: "Added." });
                setTitle("");
                setUrl("");
                setPrice("");
              }}
            >
              Add
            </Btn>
          </div>
        </Sheet>
      )}
      {sheet === "pick" && pick && (
        <Sheet title={`Go with ${pick.title}?`} onClose={() => setSheet(null)}>
          <Soft>It becomes a plan for everyone in on the gift. Each person paws in up to their limit.</Soft>
          <div className="mt-3 space-y-2">
            <Btn onClick={() => void start()}>Yes, this one</Btn>
            <Btn kind="plain" onClick={() => setSheet(null)}>
              Keep looking
            </Btn>
          </div>
        </Sheet>
      )}
    </>
  );
}
