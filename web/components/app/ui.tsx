"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

/**
 * How many screens this page load has opened. Coming back from PayPal is a fresh load, so at zero whatever is behind
 * us in the browser's history isn't ours (it can be PayPal's own pages) and Back must not step into it.
 */
type BackWindow = Window & { kittyScreens?: number };
if (typeof window !== "undefined" && (window as BackWindow).kittyScreens === undefined) {
  const w = window as BackWindow;
  w.kittyScreens = 0;
  const push = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    w.kittyScreens = (w.kittyScreens ?? 0) + 1;
    push(...args);
  };
  window.addEventListener("popstate", () => {
    w.kittyScreens = Math.max(0, (w.kittyScreens ?? 0) - 1);
  });
}

/** The small set of parts every screen is built from (PRD §B22, the Paper "Foundations" page). */

export function Btn({ kind = "main", small, className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: "main" | "plain" | "ink" | "soft"; small?: boolean }) {
  const skin = {
    main: "bg-honey text-ink shadow-[0_4px_0_var(--color-honey-edge)] active:shadow-[0_1px_0_var(--color-honey-edge)]",
    plain: "bg-card text-ink shadow-[inset_0_0_0_1.5px_var(--color-line),0_3px_0_var(--color-line)] active:shadow-[inset_0_0_0_1.5px_var(--color-line)]",
    ink: "bg-ink text-white shadow-[0_4px_0_#16112c] active:shadow-[0_1px_0_#16112c]",
    soft: "bg-inset text-ink",
  }[kind];
  return <button type="button" {...p} className={`press font-extrabold disabled:opacity-40 disabled:shadow-none ${small ? "rounded-xl px-3.5 py-2 text-[13px]" : "w-full rounded-2xl px-4 py-3.5 text-[16px]"} ${skin} ${className}`} />;
}

export const Card = ({ children, className = "", delay }: { children: ReactNode; className?: string; delay?: number }) => (
  <div className={`slide-up rounded-3xl bg-card p-4 shadow-[0_2px_0_var(--color-line)] ${className}`} style={delay ? ({ ["--delay" as string]: `${delay}ms` }) : undefined}>
    {children}
  </div>
);

export const Chip = ({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick?: () => void }) => (
  <button type="button" onClick={onClick} className={`press shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-bold ${on ? "bg-ink text-white" : "bg-card text-ink shadow-[inset_0_0_0_1.5px_var(--color-line)]"}`}>
    {children}
  </button>
);

export const Title = ({ children, className = "" }: { children: ReactNode; className?: string }) => <h1 className={`font-serif text-[30px] font-bold leading-[36px] ${className}`}>{children}</h1>;
export const H2 = ({ children, className = "" }: { children: ReactNode; className?: string }) => <h2 className={`text-[18px] font-extrabold leading-6 ${className}`}>{children}</h2>;
export const Soft = ({ children, className = "" }: { children: ReactNode; className?: string }) => <p className={`text-[13px] leading-[18px] text-soft ${className}`}>{children}</p>;
export const Label = ({ children }: { children: ReactNode }) => <p className="text-[12px] font-extrabold uppercase tracking-wider text-soft">{children}</p>;
export const Note = ({ children, kind = "mint" }: { children: ReactNode; kind?: "mint" | "honey" }) => (
  <p className={`pop-in rounded-2xl px-3.5 py-2.5 text-[13px] font-semibold leading-[18px] ${kind === "mint" ? "bg-leaf-soft" : "bg-honey-soft"}`}>{children}</p>
);

export function Field({ label, ...p }: { label?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      {label && <span className="mb-1 block text-[13px] font-bold text-soft">{label}</span>}
      <input {...p} className={`w-full rounded-2xl bg-card px-4 py-3 text-[16px] font-semibold shadow-[inset_0_0_0_1.5px_var(--color-line)] outline-none transition-shadow placeholder:font-normal placeholder:text-soft focus:shadow-[inset_0_0_0_2px_var(--color-honey)] ${p.className ?? ""}`} />
    </label>
  );
}

/** A number with - and +. Tap the number itself to type one. */
export function Stepper({ value, min, max, onChange, format = (n: number) => String(n) }: { value: number; min: number; max: number; onChange: (n: number) => void; format?: (n: number) => string }) {
  const [typing, setTyping] = useState<string | null>(null);
  const save = () => {
    if (typing) onChange(Math.min(max, Math.max(min, Number(typing))));
    setTyping(null);
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Btn kind="plain" small disabled={value <= min} onClick={() => onChange(value - 1)} aria-label="Less">−</Btn>
      {typing === null ? (
        <button key={value} type="button" aria-label={`${format(value)}, tap to type a number`} onClick={() => setTyping(String(value))} className="pop-in min-w-14 rounded-lg px-1 py-1 text-center text-[16px] font-extrabold underline decoration-soft decoration-dotted underline-offset-4">
          {format(value)}
        </button>
      ) : (
        <input
          autoFocus
          inputMode="numeric"
          aria-label="Type a number"
          value={typing}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setTyping(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-16 rounded-lg bg-card px-1 py-1 text-center text-[16px] font-extrabold shadow-[inset_0_0_0_2px_var(--color-honey)] outline-none"
        />
      )}
      <Btn kind="plain" small disabled={value >= max} onClick={() => onChange(value + 1)} aria-label="More">+</Btn>
    </div>
  );
}

/** A number that counts up to its value instead of just appearing. */
export function Count({ cents, className = "" }: { cents: number; className?: string }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / 650);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round(a + (cents - a) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
      else from.current = cents;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [cents]);
  return <span className={className}>${(shown / 100).toFixed(shown % 100 ? 2 : 0)}</span>;
}

export function Bar({ pct, kind = "honey" }: { pct: number; kind?: "honey" | "leaf" }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full bg-[rgba(42,34,69,0.1)]">
      <div className={`h-full rounded-full transition-[width] duration-700 ease-out ${kind === "honey" ? "bg-honey" : "bg-leaf"}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}

/** The mint sky behind the top of a screen. */
export function Scene({ children, kind = "band", className = "" }: { children: ReactNode; kind?: "band" | "clear" | "tall"; className?: string }) {
  return (
    <div className={`relative px-5 pb-10 pt-[max(20px,env(safe-area-inset-top))] ${className}`} style={{ backgroundImage: `url(/sky/${kind}.svg)`, backgroundSize: "cover", backgroundPosition: kind === "tall" ? "center top" : "center bottom" }}>
      {children}
    </div>
  );
}

/** The cream sheet that slides up over the sky. */
export const Paper = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={`relative -mt-7 min-h-[60%] rounded-t-[28px] bg-paper px-4 pb-32 pt-5 ${className}`}>{children}</div>;

/** A sheet that slides up from the bottom of the phone. */
export function Sheet({ onClose, title, children }: { onClose: () => void; title?: string; children: ReactNode }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 200);
  };
  const root = typeof document !== "undefined" ? document.getElementById("phone-root") : null;
  if (!root) return null;
  return createPortal(
    <div className="absolute inset-0 z-40 flex flex-col justify-end">
      <button type="button" aria-label="Close" onClick={close} className={`absolute inset-0 bg-[rgba(42,34,69,0.35)] ${closing ? "fade-out" : "fade-in"}`} />
      <div className={`relative max-h-[88%] overflow-y-auto rounded-t-[28px] bg-paper px-5 pb-8 pt-3 no-scrollbar ${closing ? "sheet-out" : "sheet-in"}`}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line" />
        {title && <h2 className="mb-3 font-serif text-[24px] font-bold leading-[30px]">{title}</h2>}
        {children}
      </div>
    </div>,
    root,
  );
}

export function Waiting() {
  return (
    <div className="flex justify-center py-8">
      <span className="typing">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

export const Toggle = ({ on }: { on: boolean }) => (
  <span className={`relative inline-block h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-leaf" : "bg-line"}`}>
    <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left] duration-300" style={{ left: on ? 22 : 2, transitionTimingFunction: "var(--spring)" }} />
  </span>
);

/** The way back, pinned to the top of a screen while everything else scrolls under it. */
export function TopBack({ href }: { href: string }) {
  return (
    <div className="sticky top-[max(10px,env(safe-area-inset-top))] z-30 h-0 pl-3">
      <span className="inline-grid h-10 w-10 place-items-center rounded-full bg-card shadow-[0_2px_0_var(--color-line)]">
        <Back href={href} />
      </span>
    </div>
  );
}

/** A screen's way back, on top of the sky. */
export function Back({ href, label = "Back" }: { href: string; label?: string }) {
  const router = useRouter();
  return (
    <a href={href} aria-label={label} className="press inline-block p-1" onClick={(e) => {
      e.preventDefault();
      if (((window as BackWindow).kittyScreens ?? 0) > 0) window.history.back();
      else router.replace(href);
    }}>
      <Icon i="back" size={26} />
    </a>
  );
}

export const Ic = {
  back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />,
  chev: <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />,
  send: <path d="M4 12l16-8-6 16-3-7-7-1z" fill="currentColor" />,
};
export const Icon = ({ i, size = 22 }: { i: keyof typeof Ic; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
    {Ic[i]}
  </svg>
);
