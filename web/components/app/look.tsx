"use client";

import type { ReactNode } from "react";
import { ACCESSORIES, EYES, EYE_COLOURS, FURS, LABELS, PALETTES, PATTERNS, type KittenLook } from "@/lib/kitten/looks";
import { Chip, Label } from "./ui";

/** Choosing how your kitten looks, at adoption and later in My Kitten (FR-UX-9). */
export function LookPicker({ look, onChange }: { look: KittenLook; onChange: (l: KittenLook) => void }) {
  const pick = (k: keyof KittenLook, v: string) => onChange({ ...look, [k]: v } as KittenLook);
  return (
    <>
      <Row label="Fur">
        {FURS.map((f) => (
          <Swatch key={f} on={look.fur === f} colour={PALETTES[f].base} label={LABELS[f]} onClick={() => pick("fur", f)} />
        ))}
      </Row>
      <Row label="Pattern">
        {PATTERNS.map((p) => (
          <Chip key={p} on={look.pattern === p} onClick={() => pick("pattern", p)}>
            {LABELS[p]}
          </Chip>
        ))}
      </Row>
      <Row label="Wears">
        {ACCESSORIES.map((a) => (
          <Chip key={a} on={look.accessory === a} onClick={() => pick("accessory", a)}>
            {LABELS[a]}
          </Chip>
        ))}
      </Row>
      <Row label="Eyes">
        {EYES.map((e) => (
          <Swatch key={e} on={look.eyes === e} colour={EYE_COLOURS[e]} label={LABELS[e]} onClick={() => pick("eyes", e)} />
        ))}
      </Row>
    </>
  );
}

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <Label>{label}</Label>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
  </div>
);

const Swatch = ({ on, colour, label, onClick }: { on: boolean; colour: string; label: string; onClick: () => void }) => (
  <button type="button" aria-label={label} onClick={onClick} className={`press h-9 w-9 rounded-full transition-shadow ${on ? "shadow-[0_0_0_2px_var(--color-paper),0_0_0_4.5px_var(--color-ink)]" : "shadow-[inset_0_0_0_1.5px_rgba(42,34,69,0.14)]"}`} style={{ background: colour }} />
);
