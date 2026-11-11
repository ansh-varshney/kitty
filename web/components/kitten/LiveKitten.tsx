"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Kitten, type KittenProps } from "./Kitten";
import type { KittenLook, Mood } from "@/lib/kitten/looks";

/**
 * A kitten that's alive (PRD §B22 "Every kitten is alive", FR-UX-11): it blinks, breathes and looks around on its own,
 * smiles now and then, pops when its mood changes, and reacts when you tap it. Use this everywhere in the app.
 */

type Props = Omit<KittenProps, "animate" | "look"> & {
  look?: Partial<KittenLook> | Record<string, unknown> | null;
  /** Tap to make it react. Off inside rows that are already tappable. */
  tappable?: boolean;
  /** Bump this number to make it react from the outside (say, when the owner picks a new colour). */
  reactKey?: number | string;
};

const Heart = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.2 3.1 4.5 6.8 4.5c2.2 0 3.9 1.2 5.2 3 1.3-1.8 3-3 5.2-3 3.7 0 5.9 3.7 4.4 7.3C19.5 16.4 12 21 12 21z" fill="#E86A86" />
  </svg>
);

export function LiveKitten({ look, mood = "neutral", tappable = true, reactKey, className, size = 160, ...rest }: Props) {
  const [flash, setFlash] = useState<Mood | null>(null);
  const [wiggle, setWiggle] = useState(0);
  const [hearts, setHearts] = useState<{ id: number; hx: number }[]>([]);
  const nextHeart = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const react = (withHeart = true) => {
    setWiggle((n) => n + 1);
    setFlash("happy");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1300);
    if (withHeart) {
      const id = ++nextHeart.current;
      setHearts((h) => [...h, { id, hx: Math.round(Math.random() * 44 - 22) }]);
      setTimeout(() => setHearts((h) => h.filter((x) => x.id !== id)), 1150);
    }
  };

  // Reacts when the owner changes something about it.
  const seen = useRef(reactKey);
  useEffect(() => {
    if (reactKey !== undefined && seen.current !== reactKey) {
      seen.current = reactKey;
      react(false);
    }
  }, [reactKey]);

  // Left alone, a calm kitten smiles to itself every so often.
  useEffect(() => {
    if (mood !== "neutral") return;
    let off = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(() => {
        if (off) return;
        setFlash("happy");
        t = setTimeout(() => {
          if (off) return;
          setFlash(null);
          tick();
        }, 1500);
      }, 5000 + Math.random() * 7000);
    };
    tick();
    return () => {
      off = true;
      clearTimeout(t);
    };
  }, [mood]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const shown = flash ?? mood;
  const body: ReactNode = <Kitten {...rest} size={size} look={look as Partial<KittenLook>} mood={shown} animate />;
  const inner = (
    <span key={`${mood}-${wiggle}`} className={`inline-block ${wiggle ? "kt-react" : "kt-pop"}`} style={{ transformOrigin: "50% 85%" }}>
      {body}
    </span>
  );

  return (
    <span className={`relative inline-block leading-none ${className ?? ""}`} style={{ width: size, height: size }}>
      {tappable ? (
        <button type="button" aria-label={`Pet ${rest.title ?? "the kitten"}`} onClick={() => react()} className="block">
          {inner}
        </button>
      ) : (
        inner
      )}
      {hearts.map((h) => (
        <span key={h.id} className="kt-heart" style={{ left: "50%", top: "22%", ["--hx" as string]: `${h.hx}px` }}>
          <Heart />
        </span>
      ))}
    </span>
  );
}
