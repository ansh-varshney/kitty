"use client";

import { api, money } from "@/lib/client/api";
import { useMoments } from "./moments";
import { NeedCard, type Item } from "./items";
import { Btn, Card, Soft } from "./ui";

/** One group's Settle up: used on a squad's Yarn tab and in My Month (FR-MONTH-5). */

export type SettleGroup = {
  squadId: string;
  squad: string;
  youOweCents: number;
  owedToYouCents: number;
  next: string;
  strands: { text: string }[];
  toPay: { settlementId: string; toName: string; cents: number; paying: boolean }[];
  toReceive: { settlementId: string; fromName: string; cents: number }[];
  toConfirm: { cardId: string; note: string; item: Item }[];
  waiting?: { cardId: string; note: string; text: string }[];
  canUntangle: boolean;
};

export function GroupActions({ g, showName }: { g: SettleGroup; showName?: boolean }) {
  const { act } = useMoments();
  return (
    <Card>
      {showName && <p className="text-[16px] font-extrabold">{g.squad}</p>}
      {g.youOweCents > 0 && <p className="text-[15px] font-bold">You owe {money(g.youOweCents)}</p>}
      {g.owedToYouCents > 0 && <p className="text-[15px] font-bold">Friends owe you {money(g.owedToYouCents)}</p>}
      {g.strands.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {g.strands.slice(0, 5).map((s, i) => (
            <Soft key={i}>{s.text}</Soft>
          ))}
        </div>
      )}
      <div className="mt-2.5 space-y-2">
        {g.toPay.map((p) => (
          <div key={p.settlementId} className="flex items-center justify-between gap-2">
            <p className="text-[15px]">You pay {p.toName}</p>
            <Btn small disabled={p.paying} onClick={() => void act("settled", () => api("POST", `yarn/settlements/${p.settlementId}/pay`), { done: "Tied off." })}>
              {p.paying ? "With PayPal" : `Pay ${money(p.cents)}`}
            </Btn>
          </div>
        ))}
        {g.toReceive.map((p) => (
          <div key={p.settlementId} className="flex items-center justify-between gap-2">
            <p className="text-[15px]">
              {p.fromName} pays you {money(p.cents)}
            </p>
            <span className="rounded-full bg-inset px-2.5 py-1 text-[12px] font-extrabold">Waiting</span>
          </div>
        ))}
        {g.toConfirm.map((c) => (
          <NeedCard key={c.item.key ?? c.cardId} item={c.item} flat />
        ))}
        {g.waiting?.map((w) => (
          <div key={w.cardId} className="flex items-center justify-between gap-2">
            <p className="text-[14px]">{w.text}</p>
            <span className="shrink-0 rounded-full bg-inset px-2.5 py-1 text-[12px] font-extrabold">Waiting</span>
          </div>
        ))}
        {g.canUntangle && <Btn onClick={() => void act("untangle", () => api("POST", `squads/${g.squadId}/untangle`), { done: "Untangled." })}>Untangle</Btn>}
      </div>
    </Card>
  );
}
