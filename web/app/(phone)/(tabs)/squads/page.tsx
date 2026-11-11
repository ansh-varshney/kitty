"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { Btn, Field, H2, Icon, Paper, Scene, Sheet, Soft, Title } from "@/components/app/ui";

/** Squads (F38): your kitten's chat pinned at the top, always (FR-CHAT-5), then every group you're in. */

type Squad = { id: string; name: string; kind: string; invite_code: string };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };
type Friend = { id: string; name: string; kittenName: string | null; look: Record<string, unknown> | null; lastText: string | null; unread: number };

export default function Page() {
  const router = useRouter();
  const { data } = useData<Squad[]>("squads");
  const { data: me } = useData<Me>("me");
  const { data: last } = useData<{ messages: { from: string; text: string }[] }>("kitten/history");
  const { data: gifts } = useData<{ group_id: string; for_name: string; status: string }[]>("gifts");
  const { data: friends } = useData<Friend[]>("friends");
  const { data: kittenNews } = useData<{ unread: number }>("kitten/unread");
  const { act } = useMoments();
  const [sheet, setSheet] = useState<"new" | "join" | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const k = me?.kitten;
  const preview = last?.messages.at(-1)?.text ?? "Ask me anything, or tell me what to do.";
  const groups = (kind: string) => (data ?? []).filter((s) => s.kind === kind);

  const create = async () => {
    setSheet(null);
    const r = await act("sending", () => api<{ id: string }>("POST", "squads", { name: name.trim() }), { working: "Building your rooftop...", done: "Your rooftop is ready." });
    if (r) router.push(`/squads/${r.id}?invite=1`);
  };
  const join = async () => {
    setSheet(null);
    const r = await act("sending", () => api<{ id: string }>("POST", "squads/join", { code: code.trim() }), { working: "Climbing up...", done: "You're on the rooftop." });
    if (r) router.push(`/squads/${r.id}`);
  };

  return (
    <>
      <Scene kind="clear" className="!pb-12">
        <Title>Squads</Title>
        <Soft className="mt-1 !text-ink">Your kitten and your friends.</Soft>
      </Scene>
      <Paper className="space-y-3">
        <Link href="/chat" className="press pop-in flex items-center gap-3 rounded-3xl bg-ink p-3 text-white shadow-[0_4px_0_#16112c]">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-sky-top">
            <LiveKitten look={k?.look} view="head" size={52} tappable={false} title={k?.name} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-extrabold leading-6">{k?.name ?? "Your kitten"}</span>
            <span className="block truncate text-[13px] text-white/75">{preview}</span>
          </span>
          {(kittenNews?.unread ?? 0) > 0 ? (
            <span key={kittenNews?.unread} className="pop-in grid h-[24px] min-w-[24px] shrink-0 place-items-center rounded-full bg-blush px-1.5 text-[13px] font-extrabold text-white">
              {kittenNews?.unread}
            </span>
          ) : (
            <span className="text-white/70">
              <Icon i="chev" size={20} />
            </span>
          )}
        </Link>

        {data && data.length === 0 && <Soft className="py-4 text-center">No squads yet. Start one, or join with a code.</Soft>}
        <List squads={groups("squad")} />
        {groups("mini").length > 0 && (
          <>
            <H2 className="pt-2">Plans with friends</H2>
            <List squads={groups("mini")} />
          </>
        )}
        {(gifts ?? []).filter((g) => g.status === "joined").length > 0 && (
          <>
            <H2 className="pt-2">Secret gifts</H2>
            {(gifts ?? [])
              .filter((g) => g.status === "joined")
              .map((g) => (
                <Link key={g.group_id} href={`/gifts/${g.group_id}`} className="press slide-up flex items-center gap-3 rounded-3xl bg-lilac-soft p-3.5 shadow-[0_2px_0_var(--color-line)]">
                  <span className="min-w-0 flex-1 truncate text-[16px] font-extrabold">A gift for {g.for_name}</span>
                  <span className="text-soft">
                    <Icon i="chev" size={18} />
                  </span>
                </Link>
              ))}
          </>
        )}
        {(friends ?? []).length > 0 && (
          <>
            <H2 className="pt-2">Friends</H2>
            {friends?.map((f, i) => (
              <Link key={f.id} href={`/chat/${f.id}`} className="press slide-up flex items-center gap-3 rounded-3xl bg-card p-3 shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${i * 40}ms` }}>
                <LiveKitten look={f.look ?? undefined} view="head" size={46} tappable={false} title={f.kittenName ?? f.name} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-extrabold">{f.name}</span>
                  <span className="block truncate text-[13px] text-soft">{f.lastText ?? `Message ${f.name} or ${f.kittenName ?? "their kitten"}`}</span>
                </span>
                {f.unread > 0 && <span className="pop-in grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-blush px-1 text-[12px] font-extrabold text-white">{f.unread}</span>}
              </Link>
            ))}
          </>
        )}
        <div className="flex gap-2 pt-2">
          <Btn onClick={() => setSheet("new")}>New squad</Btn>
          <Btn kind="plain" onClick={() => setSheet("join")}>
            Join with a code
          </Btn>
        </div>
      </Paper>

      {sheet === "new" && (
        <Sheet title="New squad" onClose={() => setSheet(null)}>
          <Field placeholder="Squad name" autoFocus maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          <Btn className="mt-4" disabled={!name.trim()} onClick={() => void create()}>
            Create
          </Btn>
        </Sheet>
      )}
      {sheet === "join" && (
        <Sheet title="Join a squad" onClose={() => setSheet(null)}>
          <Field placeholder="Invite link or code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
          <Btn className="mt-4" disabled={code.trim().length < 3} onClick={() => void join()}>
            Join
          </Btn>
        </Sheet>
      )}
    </>
  );
}

function List({ squads }: { squads: Squad[] }) {
  return (
    <>
      {squads.map((s, i) => (
        <Link key={s.id} href={`/squads/${s.id}`} className="press slide-up flex items-center gap-3 rounded-3xl bg-card p-3.5 shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${i * 50}ms` }}>
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-inset text-[17px] font-extrabold">{s.name[0]?.toUpperCase()}</span>
          <span className="min-w-0 flex-1 truncate text-[16px] font-extrabold">{s.name}</span>
          <span className="text-soft">
            <Icon i="chev" size={18} />
          </span>
        </Link>
      ))}
    </>
  );
}
