"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useData, useLiveStream } from "@/lib/client/api";
import { PlusSheets, type PlusMode } from "@/components/app/plus";
import { runItem, type Item } from "@/components/app/items";
import { useMoments } from "@/components/app/moments";
import { Icon } from "@/components/app/ui";

/** The app once you're in: live data, urgent alerts, and the bottom tabs (FR-UX-1, §B22 App structure). */

type Me = { user: { onboarded: boolean } };

const TABS = [
  { href: "/meows", label: "Meows", icon: <path d="M3 7a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7zm1 .5l8 6 8-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /> },
  { href: "/squads", label: "Squads", icon: <path d="M3 11.5L12 4l9 7.5M6 10v9.5h4.5V14h3v5.5H18V10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> },
  { href: "/month", label: "My Month", icon: <path d="M4 7a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V7zm0 3h16M8 3v4m8-4v4M8 14h2m4 0h2m-8 3.5h2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> },
  { href: "/kitten", label: "My Kitten", icon: <path d="M5 5l3.5 3h7L19 5v8a7 7 0 01-14 0V5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /> },
];

/** Once you've closed an alert it stays closed, even after you come back to the app. */
function dismissedAlerts(): string[] {
  try {
    return JSON.parse(localStorage.getItem("kitty-alerts-closed") ?? "[]");
  } catch {
    return [];
  }
}
function rememberDismissed(gone: string[], text: string) {
  const next = [...gone, text].slice(-40);
  try {
    localStorage.setItem("kitty-alerts-closed", JSON.stringify(next));
  } catch {
    /* it just stays closed for this visit */
  }
  return next;
}

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <Shell>{children}</Shell>
    </Suspense>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data, error } = useData<Me>("me");
  const { data: meows } = useData<{ sections: { needsYou: unknown[] } }>(data ? "meows" : null);
  const { data: alerts } = useData<{ items: Item[] }>(data ? "alerts" : null);
  const { data: friends } = useData<{ unread: number }[]>(data ? "friends" : null);
  const { data: kittenNews } = useData<{ unread: number }>(data ? "kitten/unread" : null);
  const [plus, setPlus] = useState<PlusMode>(null);
  const [gone, setGone] = useState<string[]>(dismissedAlerts);
  const { act, toast } = useMoments();
  useLiveStream(Boolean(data));

  useEffect(() => {
    if (error?.status === 401) router.replace("/");
    else if (data && !data.user.onboarded) router.replace("/adopt");
  }, [data, error, router]);

  const count = meows?.sections.needsYou.length ?? 0;
  const alert = alerts?.items.find((a) => !gone.includes(a.text));
  // The bottom tabs belong to the four main screens only. Inside a chat, a plan or a sub-page they'd just be in the way.
  const atRoot = ["/meows", "/squads", "/month", "/kitten"].includes(path);
  const unread = (friends ?? []).reduce((a, f) => a + f.unread, 0) + (kittenNews?.unread ?? 0);

  return (
    <div className="flex h-full flex-col">
      {alert && atRoot && (
        <div key={alert.text} className="slide-up absolute inset-x-3 top-[max(10px,env(safe-area-inset-top))] z-30 flex items-center gap-2 rounded-2xl bg-honey-soft p-3 shadow-lg">
          <button type="button" className="min-w-0 flex-1 text-left text-[14px] font-bold" onClick={() => void runItem(alert, { router, act, toast })}>
            {alert.text}
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setGone(rememberDismissed(gone, alert.text))}>
            <Icon i="close" size={18} />
          </button>
        </div>
      )}
      <main className="relative min-h-0 flex-1 overflow-y-auto no-scrollbar">{children}</main>
      {atRoot && (
        <nav className="relative z-20 flex shrink-0 items-end justify-around rounded-t-3xl bg-card px-1 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-2px_0_var(--color-line)]">
          {TABS.slice(0, 2).map((t) => (
            <Tab key={t.href} {...t} active={path.startsWith(t.href)} badge={t.href === "/meows" ? count : unread} />
          ))}
          <button type="button" aria-label="New" onClick={() => setPlus("menu")} className="press -mt-7 grid h-[60px] w-[60px] place-items-center rounded-full bg-honey text-ink shadow-[0_4px_0_var(--color-honey-edge)]">
            <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
              <path d="M12 4v16M4 12h16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
          {TABS.slice(2).map((t) => (
            <Tab key={t.href} {...t} active={path.startsWith(t.href)} badge={0} />
          ))}
        </nav>
      )}
      <PlusSheets mode={plus} setMode={setPlus} />
    </div>
  );
}

function Tab({ href, label, icon, active, badge }: { href: string; label: string; icon: React.ReactNode; active: boolean; badge: number }) {
  return (
    <Link href={href} className={`press relative flex w-[68px] flex-col items-center gap-0.5 text-[11px] ${active ? "font-extrabold text-ink" : "font-semibold text-soft"}`}>
      <span key={String(active)} className={active ? "pop-in" : ""}>
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden>
          {icon}
        </svg>
      </span>
      {label}
      {badge > 0 && <span key={badge} className="pop-in absolute right-3 top-0 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-blush px-1 text-[11px] font-extrabold text-white">{badge}</span>}
    </Link>
  );
}
