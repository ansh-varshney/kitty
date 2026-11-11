"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api } from "@/lib/client/api";
import { Soft } from "@/components/app/ui";

/** The front door (FR-SHOW-1): Log in with PayPal, and nothing else. */
export default function Page() {
  return (
    <Suspense>
      <Welcome />
    </Suspense>
  );
}

function storedInvite() {
  try {
    return localStorage.getItem("kitty-invite");
  } catch {
    return null;
  }
}
function clearStoredInvite() {
  try {
    localStorage.removeItem("kitty-invite");
  } catch {
    /* nothing to clear */
  }
}

function Welcome() {
  const router = useRouter();
  const joined = useRef(false);
  const params = useSearchParams();
  const login = params.get("login");

  useEffect(() => {
    const invite = params.get("invite");
    if (invite) {
      try {
        localStorage.setItem("kitty-invite", invite);
      } catch {
        /* private window: they can still type the code */
      }
    }
    // Already signed in: straight in. PayPal's returns land here too, so pass along what they said.
    api<{ user: { onboarded: boolean } }>("GET", "me")
      .then(async (me) => {
        if (!me.user.onboarded) return router.replace("/adopt");
        const code = invite ?? storedInvite();
        if (code && !joined.current) {
          joined.current = true;
          clearStoredInvite();
          const squad = await api<{ id: string }>("POST", "squads/join", { code }).catch(() => null);
          if (squad) return router.replace(`/squads/${squad.id}`);
        }
        const plan = params.get("plan");
        router.replace(plan ? `/plans/${plan}?hold=${params.get("hold") ?? "done"}` : `/meows?${params.toString()}`);
      })
      .catch(() => undefined);
  }, [router, params]);

  return (
    <div className="flex h-full flex-col" style={{ backgroundImage: "url(/sky/tall.svg)", backgroundSize: "cover" }}>
      <div className="flex flex-1 flex-col items-center justify-end">
        <div className="slide-up">
          <LiveKitten mood="happy" pose="wave" size={230} title="A kitten waving hello" />
        </div>
      </div>
      <div className="sheet-in rounded-t-[32px] bg-paper px-6 pb-[max(32px,env(safe-area-inset-bottom))] pt-7">
        <h1 className="font-serif text-[44px] font-bold leading-[48px]">Kitty</h1>
        <p className="mt-2 text-[18px] leading-[26px]">Plan, pay and save with friends. Your kitten handles the awkward parts.</p>
        {login && login !== "new" && login !== "done" && <p className="shake mt-4 rounded-2xl bg-honey-soft px-4 py-3 text-[14px] font-semibold">That didn&apos;t finish. Try again.</p>}
        {/* A full-page trip to PayPal, not an in-app route. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/v1/auth/login" className="press mt-6 block w-full rounded-2xl bg-honey px-4 py-4 text-center text-[17px] font-extrabold shadow-[0_4px_0_var(--color-honey-edge)]">
          Log in with PayPal
        </a>
        <Soft className="mt-4 text-center">PayPal logs you in and fills your Treat Jar. Every payment in Kitty comes from the jar.</Soft>
      </div>
    </div>
  );
}
