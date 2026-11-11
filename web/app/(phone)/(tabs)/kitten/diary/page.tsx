"use client";

import { useState } from "react";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { dayTime, useData } from "@/lib/client/api";
import { TopBack, Chip, Paper, Scene, Soft, Title, Waiting } from "@/components/app/ui";

/** Kitten Diary (PRD §B19): everything your kitten did, why, and the PayPal receipt when money moved. */

type Entry = { id: number; type: string; actor: string; payload: { text?: string; cents?: number }; reason: string | null; paypalId: string | null; createdAt: string; line: string };
type Me = { kitten: { name: string; look: Record<string, unknown> } | null };

export default function Page() {
  const { data } = useData<Entry[]>("diary");
  const { data: me } = useData<Me>("me");
  const [filter, setFilter] = useState<"all" | "kitten" | "money">("all");
  const [open, setOpen] = useState<number | null>(null);
  const rows = (data ?? [])
    .filter((e) => !e.type.startsWith("chat."))
    .filter((e) => filter === "all" || (filter === "kitten" ? e.actor === "kitten" : e.paypalId || e.payload.cents));

  return (
    <>
      <TopBack href="/kitten" />
      <Scene>
        <div className="flex items-end justify-between gap-2">
          <div className="pb-4">
            <div className="h-10" />
            <Title>Kitten Diary</Title>
            <Soft className="mt-1 !text-ink">Tap a line to see why.</Soft>
          </div>
          <LiveKitten look={me?.kitten?.look} mood="thinking" size={116} className="shrink-0" />
        </div>
      </Scene>
      <Paper className="space-y-2">
        <div className="flex gap-1.5 pb-1">
          <Chip on={filter === "all"} onClick={() => setFilter("all")}>Everything</Chip>
          <Chip on={filter === "kitten"} onClick={() => setFilter("kitten")}>By my kitten</Chip>
          <Chip on={filter === "money"} onClick={() => setFilter("money")}>Money</Chip>
        </div>
        {!data && <Waiting />}
        {data && !rows.length && <Soft className="py-6 text-center">Nothing here yet.</Soft>}
        {rows.map((e, i) => (
          <button key={e.id} type="button" onClick={() => setOpen(open === e.id ? null : e.id)} className="press slide-up block w-full rounded-2xl bg-card p-3 text-left shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${Math.min(i, 10) * 25}ms` }}>
            <p className="text-[15px] leading-[21px]">{e.line}</p>
            <Soft className="mt-0.5">{dayTime(e.createdAt)}</Soft>
            {open === e.id && (
              <div className="pop-in mt-1.5 border-t border-line pt-1.5">
                <Soft>{e.reason ? `Why: ${e.reason}` : "No reason was recorded."}</Soft>
                {e.paypalId && <Soft className="break-all">PayPal ID: {e.paypalId}</Soft>}
              </div>
            )}
          </button>
        ))}
      </Paper>
    </>
  );
}
