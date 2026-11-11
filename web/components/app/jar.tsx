"use client";

import { useState } from "react";
import { api, money, toCents } from "@/lib/client/api";
import { useMoments } from "./moments";
import { Btn, Chip, Count, Field, Sheet, Soft } from "./ui";

/** Add money to the Treat Jar, or take it back out. Opened from My Month. */
export function JarSheet({ jar, name, onClose }: { jar: { availableCents: number; heldCents: number }; name: string; onClose: () => void }) {
  const { act } = useMoments();
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"add" | "take">("add");
  const cents = toCents(amount);
  const tooMuch = mode === "take" && cents > jar.availableCents;
  return (
    <Sheet title="Treat Jar" onClose={onClose}>
      <p className="text-[34px] font-extrabold leading-10">
        <Count cents={jar.availableCents} />
      </p>
      <Soft>free, and {money(jar.heldCents)} set aside for plans. Pocket money for {name} to pay small things without asking. Yours to take back anytime.</Soft>
      <div className="mt-3 flex gap-1.5">
        <Chip on={mode === "add"} onClick={() => setMode("add")}>
          Add money
        </Chip>
        <Chip on={mode === "take"} onClick={() => setMode("take")}>
          Take it out
        </Chip>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[1000, 2500, 5000].map((c) => (
          <Chip key={c} on={cents === c} onClick={() => setAmount(String(c / 100))}>
            ${c / 100}
          </Chip>
        ))}
      </div>
      <div className="mt-2">
        <Field inputMode="decimal" placeholder="Other amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      {tooMuch && <Soft className="mt-2">You have {money(jar.availableCents)} free to take out.</Soft>}
      <Btn
        className="mt-3"
        disabled={!cents || tooMuch}
        onClick={() => {
          onClose();
          void act(mode === "add" ? "saving" : "released", () => api("POST", mode === "add" ? "jar/topup" : "jar/withdraw", { cents }), { done: mode === "add" ? "Into the jar." : "On its way to your PayPal." });
        }}
      >
        {mode === "add" ? "Continue with PayPal" : "Send to my PayPal"}
      </Btn>
    </Sheet>
  );
}
