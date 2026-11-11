"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { Icon, Note, Paper, Scene, Soft, Title, Waiting } from "@/components/app/ui";

/**
 * Local testing only: PayPal refuses localhost for login, so here you pick which sandbox person you are.
 * The server refuses this everywhere except a dev server on localhost, and this screen then sends you home.
 */

type Person = { name: string; email: string; onboarded: boolean; kitten: string | null; look: Record<string, unknown> | null };

export default function Page() {
  const router = useRouter();
  const { data, error } = useData<Person[]>("auth/local-people");
  const { act } = useMoments();

  useEffect(() => {
    if (error) router.replace("/");
  }, [error, router]);

  const pick = async (p: Person) => {
    const ok = await act("paypal", () => api("POST", "auth/local-login", { email: p.email }), { working: "Logging you in...", minMs: 500, stop: () => true });
    if (ok) window.location.assign("/");
  };

  return (
    <div className="h-full overflow-y-auto no-scrollbar">
      <Scene>
        <div className="pb-4">
          <Title>Who&apos;s logging in?</Title>
          <Soft className="mt-1 !text-ink">Only on this computer. The live site uses real PayPal.</Soft>
        </div>
      </Scene>
      <Paper className="space-y-2.5">
        {!data && !error && <Waiting />}
        {data && !data.length && <Note kind="honey">No sandbox accounts found in this folder.</Note>}
        {data?.map((p, i) => (
          <button key={p.email} type="button" onClick={() => void pick(p)} className="press slide-up flex w-full items-center gap-3 rounded-3xl bg-card p-3 text-left shadow-[0_2px_0_var(--color-line)]" style={{ ["--delay" as string]: `${i * 45}ms` }}>
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-inset text-[18px] font-extrabold">
              {p.kitten ? <LiveKitten look={p.look ?? undefined} view="head" size={44} tappable={false} title={p.kitten} /> : p.name[0]?.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-extrabold">{p.name}</span>
              <span className="block truncate text-[13px] text-soft">{p.onboarded ? `With ${p.kitten}` : "New, starts at sign-up"}</span>
            </span>
            <Icon i="chev" size={18} />
          </button>
        ))}
      </Paper>
    </div>
  );
}
