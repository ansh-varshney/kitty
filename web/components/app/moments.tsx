"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { PROPS } from "@/components/kitten/Kitten";
import { MOMENTS, type KittenProp, type KittenState } from "@/lib/kitten/moments";
import { ApiError, money, RefillDeclined, refreshAll, setRefillAsker, useData } from "@/lib/client/api";
import { Btn, Sheet } from "./ui";

/**
 * Moments (PRD §B22 "Money moments", FR-UX-4, FR-UX-11): nothing in Kitty is "tap, wait, done". While an action runs,
 * its moment plays: the kitten moves, things fly, the pot fills. `act()` runs the action behind the moment, handles the
 * PayPal hand-off, and ends on a little celebration or a calm note if something didn't work.
 */

export type MomentKind = "reading" | "sending" | "pawIn" | "pawUp" | "cover" | "pounce" | "released" | "leftovers" | "untangle" | "settled" | "saving" | "helping" | "catnip" | "paypal" | "thinking" | "welcome";

type Phase = "working" | "done" | "error";
type Run = { id: number; kind: MomentKind; phase: Phase; working: string; done?: string; error?: string };
type ActOpts<T = never> = { working?: string; done?: string; minMs?: number; stop?: (result: T) => boolean };
type Ctx = {
  act: <T>(kind: MomentKind, fn: () => Promise<T>, opts?: ActOpts<T>) => Promise<T | undefined>;
  toast: (text: string) => void;
};

const MomentCtx = createContext<Ctx>({ act: async () => undefined, toast: () => undefined });
export const useMoments = () => useContext(MomentCtx);

const WORKING: Record<MomentKind, string> = {
  reading: "Reading that for you...",
  sending: "Off it goes...",
  pawIn: "Setting it aside...",
  pawUp: "Stretching a little...",
  cover: "Sliding a coin over...",
  pounce: "Pounce!",
  released: "Letting it go...",
  leftovers: "Rolling it back...",
  untangle: "Untangling...",
  settled: "Tying it off...",
  saving: "Into the jar...",
  helping: "Paws in...",
  catnip: "Wrapping it up...",
  paypal: "Waiting on PayPal...",
  thinking: "One moment...",
  welcome: "Getting your rooftop ready...",
};

const STATE: Record<MomentKind, KittenState> = {
  reading: MOMENTS.reading,
  sending: MOMENTS.sending,
  pawIn: MOMENTS.pawIn,
  pawUp: MOMENTS.pawIn,
  cover: MOMENTS.pawIn,
  pounce: MOMENTS.pounce,
  released: { mood: "neutral", pose: "wave" },
  leftovers: MOMENTS.pawIn,
  untangle: MOMENTS.untangle,
  settled: MOMENTS.settled,
  saving: MOMENTS.partySaving,
  helping: MOMENTS.helping,
  catnip: MOMENTS.catnip,
  paypal: { mood: "neutral", pose: "sit" },
  thinking: { mood: "thinking", pose: "sit" },
  welcome: { mood: "happy", pose: "wave" },
};

const Coin = ({ size = 34 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="-20 -14 40 40" aria-hidden>
    {PROPS.coin}
  </svg>
);
const Plane = () => (
  <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden>
    <path d="M2 11 22 3l-6 18-4-7-10-3z" fill="#fff" stroke="#2A2245" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="M12 14l10-11" stroke="#2A2245" strokeWidth="1.2" />
  </svg>
);

function Pot({ from = 12, to = 72, label }: { from?: number; to?: number; label?: string }) {
  return (
    <div className="relative h-[108px] w-[104px] overflow-hidden rounded-b-[34px] rounded-t-xl border-[4px] border-ink bg-card">
      <div className="m-fill absolute inset-x-0 bottom-0 bg-leaf" style={{ ["--from" as string]: `${from}%`, ["--to" as string]: `${to}%` }} />
      {label && <span className="absolute inset-0 grid place-items-center text-[13px] font-extrabold">{label}</span>}
    </div>
  );
}

const CONFETTI = ["#F0A43A", "#5FC4A0", "#E86A86", "#B9AEF5", "#F2C14E"];

/** A burst of paper and coins: the reward at the end of a moment. */
function Burst({ count = 26 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2;
        const r = 120 + ((i * 53) % 90);
        return (
          <span
            key={i}
            className="m-burst"
            style={{
              ["--dx" as string]: `${Math.round(Math.cos(a) * r)}px`,
              ["--dy" as string]: `${Math.round(Math.sin(a) * r)}px`,
              ["--rot" as string]: `${(i * 97) % 540}deg`,
              ["--delay" as string]: `${(i % 5) * 26}ms`,
              width: i % 3 ? 10 : 8,
              height: i % 3 ? 14 : 8,
              borderRadius: i % 3 ? 3 : 99,
              background: CONFETTI[i % CONFETTI.length],
            }}
          />
        );
      })}
    </>
  );
}

function Fx({ kind }: { kind: MomentKind }) {
  const coins = (n: number, cls: string, left: number, spread: number) =>
    Array.from({ length: n }, (_, i) => (
      <span key={i} className={cls} style={{ left: left + (i - n / 2) * spread, top: 90, ["--delay" as string]: `${i * 170}ms` }}>
        <Coin />
      </span>
    ));
  switch (kind) {
    case "sending":
      return (
        <>
          {[
            [-140, -150],
            [40, -190],
            [150, -120],
            [-70, -210],
          ].map(([px, py], i) => (
            <span key={i} className="m-plane" style={{ left: 142, top: 160, ["--px" as string]: `${px}px`, ["--py" as string]: `${py}px`, ["--delay" as string]: `${i * 240}ms` }}>
              <Plane />
            </span>
          ))}
        </>
      );
    case "pawIn":
    case "pawUp":
      return (
        <>
          {coins(4, "m-coin-fall", 232, 8)}
          <div className="absolute bottom-4 right-3">
            <Pot from={kind === "pawUp" ? 58 : 14} to={kind === "pawUp" ? 76 : 66} />
          </div>
        </>
      );
    case "saving":
      return (
        <>
          {coins(3, "m-coin-fall", 232, 6)}
          <div className="absolute bottom-4 right-3">
            <Pot from={30} to={58} label="Savings" />
          </div>
        </>
      );
    case "released":
      return (
        <>
          {coins(5, "m-coin-up", 160, 42)}
        </>
      );
    case "helping":
      return <>{coins(5, "m-coin-up", 160, 46)}</>;
    case "cover":
    case "leftovers":
      return <>{coins(3, "m-coin-across", 148, 0)}</>;
    case "pounce":
      return <>{coins(6, "m-coin-across", 148, 0)}</>;
    case "untangle":
      return (
        <svg className="absolute left-1/2 top-3 -translate-x-1/2" width="230" height="110" viewBox="0 0 230 110" aria-hidden>
          <path className="m-unravel" d="M6 90 C 40 10, 70 110, 110 50 S 180 10, 224 60" fill="none" stroke="#E86A86" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    case "settled":
      return <Burst count={16} />;
    case "catnip":
      return (
        <>
          {[-56, -18, 22, 60].map((x, i) => (
            <span key={x} className="m-ribbon absolute top-8 h-3 w-14 rounded-full" style={{ left: 134 + x, background: CONFETTI[i], rotate: `${x / 2}deg`, ["--delay" as string]: `${i * 180}ms` }} />
          ))}
        </>
      );
    default:
      return null;
  }
}

function PayPalPaw() {
  return (
    <span className="m-tap absolute bottom-3 left-[calc(50%+34px)] block h-5 w-8 rounded-full bg-honey" style={{ transformOrigin: "20% 100%" }} />
  );
}

function Overlay({ run, onClose }: { run: Run; onClose: () => void }) {
  const { data } = useData<{ kitten?: { look: Record<string, unknown>; name: string } }>("me");
  const state = STATE[run.kind];
  const done = run.phase === "done";
  const failed = run.phase === "error";
  const mood = failed ? "neutral" : done ? (run.kind === "pounce" ? "happy" : "proud") : state.mood;
  const pose = failed ? "sit" : done && run.kind !== "pounce" ? "sit" : state.pose;
  const prop = !failed && !done && state.prop ? PROPS[state.prop as KittenProp] : undefined;
  const hop = !failed && !done && ["pounce", "thinking", "paypal", "welcome"].includes(run.kind);
  const scan = !done && !failed && run.kind === "reading";

  return (
    <div className="fade-in absolute inset-0 z-50 flex flex-col items-center justify-center px-8" style={{ backgroundImage: "url(/sky/tall.svg)", backgroundSize: "cover" }}>
      <div className="relative h-[300px] w-[320px]">
        {!done && !failed && <Fx kind={run.kind} />}
        {done && <Burst count={run.kind === "pounce" ? 44 : 24} />}
        <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 ${["pawIn", "pawUp", "saving"].includes(run.kind) && !done ? "ml-[-54px]" : ""}`}>
          <div key={run.phase} className={done ? "m-kitten-jump" : hop ? "m-hop" : scan ? "m-scan" : "pop-in"}>
            <LiveKitten look={data?.kitten?.look} mood={mood} pose={pose} prop={prop} size={run.kind === "pounce" || done ? 210 : 180} tappable={false} title={data?.kitten?.name} />
          </div>
          {run.kind === "paypal" && !done && !failed && <PayPalPaw />}
        </div>
      </div>
      <p key={run.phase} className="pop-in mt-5 text-center font-serif text-[30px] font-bold leading-[36px]">
        {failed ? "That didn't work" : done ? (run.done ?? "Done!") : run.working}
      </p>
      {failed && (
        <div className="pop-in mt-3 w-full text-center">
          <p className="text-[15px] leading-[22px] text-soft">{run.error}</p>
          <Btn className="mt-5" onClick={onClose}>OK</Btn>
        </div>
      )}
    </div>
  );
}

export function MomentProvider({ children }: { children: ReactNode }) {
  const [run, setRun] = useState<Run | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [refill, setRefill] = useState<{ shortCents: number; jarCents: number; answer: (yes: boolean) => void } | null>(null);
  const ids = useRef(0);

  // The one place in the app that offers PayPal for a payment: refilling the Treat Jar (FR-JAR-7).
  useEffect(() => {
    setRefillAsker((ask) => new Promise<boolean>((resolve) => setRefill({ ...ask, answer: (yes) => (setRefill(null), resolve(yes)) })));
    return () => setRefillAsker(null);
  }, []);

  const toast = useCallback((text: string) => {
    const id = ++ids.current;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const act = useCallback(async <T,>(kind: MomentKind, fn: () => Promise<T>, opts: ActOpts<T> = {}): Promise<T | undefined> => {
    const id = ++ids.current;
    setRun({ id, kind, phase: "working", working: opts.working ?? WORKING[kind], done: opts.done });
    const started = Date.now();
    try {
      const result = await fn();
      // Long enough to enjoy, never long enough to be slow.
      const wait = (opts.minMs ?? 1150) - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (opts.stop?.(result)) {
        setRun(null);
        refreshAll();
        return result;
      }
      const approve = (result as { approveUrl?: string } | null)?.approveUrl;
      if (approve) {
        setRun({ id, kind: "paypal", phase: "working", working: WORKING.paypal });
        await new Promise((r) => setTimeout(r, 650));
        window.location.href = approve;
        return result;
      }
      setRun({ id, kind, phase: "done", working: "", done: (result as { message?: string } | null)?.message ?? opts.done });
      await new Promise((r) => setTimeout(r, kind === "pounce" ? 1500 : 950));
      setRun(null);
      refreshAll();
      return result;
    } catch (e) {
      if (e instanceof RefillDeclined) {
        setRun(null);
        return undefined;
      }
      const message = e instanceof ApiError ? e.message : "That didn't work. Nothing changed.";
      setRun({ id, kind, phase: "error", working: "", error: message });
      return undefined;
    }
  }, []);

  return (
    <MomentCtx.Provider value={{ act, toast }}>
      {children}
      {run && !refill && <Overlay run={run} onClose={() => setRun(null)} />}
      {refill && (
        <Sheet title="Refill your Treat Jar?" onClose={() => refill.answer(false)}>
          <p className="text-[16px] leading-6">
            Your Treat Jar has {money(refill.jarCents)}, and this needs {money(refill.jarCents + refill.shortCents)}. Add {money(refill.shortCents)} with PayPal, and your kitten takes it all from the jar.
          </p>
          <div className="mt-4 space-y-2">
            <Btn onClick={() => refill.answer(true)}>Refill {money(refill.shortCents)}</Btn>
            <Btn kind="plain" onClick={() => refill.answer(false)}>
              Not now
            </Btn>
          </div>
        </Sheet>
      )}
      <div className="pointer-events-none absolute inset-x-4 top-[max(14px,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <p key={t.id} className="pop-in rounded-2xl bg-ink px-4 py-2.5 text-center text-[14px] font-bold text-white shadow-lg">
            {t.text}
          </p>
        ))}
      </div>
    </MomentCtx.Provider>
  );
}
