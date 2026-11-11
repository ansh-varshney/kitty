"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { PROPS } from "@/components/kitten/Kitten";
import { api, money, toCents, useData } from "@/lib/client/api";
import { useMoments } from "./moments";
import { Btn, Chip, Field, Label, Sheet, Soft, Stepper } from "./ui";

/** The + button (F6), and the three things it starts: a whim (F9), "I paid" (F28), asking friends for help (F32). */

export type PlusMode = null | "menu" | "whim" | "paid" | "help";
type Squad = { id: string; name: string; kind: string };
type Member = { id: string; name: string };

export function PlusSheets({ mode, setMode, squadId }: { mode: PlusMode; setMode: (m: PlusMode) => void; squadId?: string }) {
  const close = () => setMode(null);
  if (mode === "menu")
    return (
      <Sheet onClose={close} title="What's up?">
        <div className="space-y-2.5">
          <Btn onClick={() => setMode("whim")}>New whim</Btn>
          <Btn kind="plain" onClick={() => setMode("paid")}>I paid</Btn>
          <Btn kind="plain" onClick={() => setMode("help")}>Ask friends for help</Btn>
        </div>
      </Sheet>
    );
  if (mode === "whim") return <WhimSheet onClose={close} squadId={squadId} />;
  if (mode === "paid") return <PaidSheet onClose={close} squadId={squadId} />;
  if (mode === "help") return <HelpSheet onClose={close} />;
  return null;
}

function useMyKitten() {
  const { data } = useData<{ kitten: { name: string; look: Record<string, unknown> } | null }>("me");
  return data?.kitten;
}

function SquadPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { data } = useData<Squad[]>("squads");
  const list = (data ?? []).filter((s) => s.kind !== "gift");
  useEffect(() => {
    if (!value && list[0]) onChange(list[0].id);
  }, [value, list, onChange]);
  if (data && !list.length) return <Soft>Start or join a squad first.</Soft>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((s) => (
        <Chip key={s.id} on={value === s.id} onClick={() => onChange(s.id)}>
          {s.name}
        </Chip>
      ))}
    </div>
  );
}

type Parsed = { what?: string | null; whenText?: string | null; startsAt?: string | null; endsAt?: string | null; priceCents?: number | null; upToCents?: number | null; place?: string | null; imageUrl?: string | null; sourceUrl?: string | null };

/** For a date-and-time box: the moment in the phone's own time. */
const forPicker = (iso?: string | null) => {
  if (!iso) return "";
  const t = new Date(iso);
  return new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
/** "Friday" with no time arrives as midnight. For friends an evening is the better guess, and it's right there to change. */
const evening = (picker: string) => (picker.endsWith("T00:00") ? `${picker.slice(0, 10)}T19:00` : picker);

/** Compose → the kitten reads it → check every detail → off it goes. It becomes a plan by itself once enough say yes. */
export function WhimSheet({ onClose, squadId: fixed, initialText }: { onClose: () => void; squadId?: string; initialText?: string }) {
  const k = useMyKitten();
  const { act } = useMoments();
  const router = useRouter();
  const [step, setStep] = useState<"write" | "reading" | "check">(initialText ? "reading" : "write");
  const [text, setText] = useState(initialText ?? "");
  const [image, setImage] = useState<{ b64: string; mime: string; name: string } | null>(null);
  const [picked, setPicked] = useState(fixed ?? "");
  const [people, setPeople] = useState<string[]>([]);
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [when, setWhen] = useState("");
  const [price, setPrice] = useState("");
  const [mode, setMode] = useState<"total" | "per_person">("total");
  const [need, setNeed] = useState(2);
  const [fromSavings, setFromSavings] = useState(false);
  const [booker, setBooker] = useState("");
  const [decide, setDecide] = useState("");
  const [parsed, setParsed] = useState<Parsed>({});
  const file = useRef<HTMLInputElement>(null);
  const { data: me } = useData<{ user: { id: string } }>("me");
  const { data: squads } = useData<Squad[]>("squads");
  const { data: friends } = useData<Member[]>("friends");
  const list = (squads ?? []).filter((s) => s.kind !== "gift");
  const squadId = people.length ? "" : picked || list[0]?.id || "";
  const { data: squad } = useData<{ members: Member[] }>(squadId ? `squads/${squadId}` : null);
  const { data: partyData } = useData<{ party: { name: string } | null }>(squadId ? `squads/${squadId}/party` : null);
  const party = people.length ? null : (partyData?.party ?? null);
  const group = people.length ? (friends ?? []).filter((f) => people.includes(f.id)) : (squad?.members ?? []).filter((m) => m.id !== me?.user.id);
  const size = group.length + 1;
  // Chosen friends: it goes ahead as soon as one says yes. "Need at least" is only a question for a whole squad.
  const needed = people.length ? 2 : Math.min(Math.max(2, need), Math.max(2, size));
  const bookerId = group.some((m) => m.id === booker) ? booker : (me?.user.id ?? "");
  const cents = toCents(price);
  const lateDecide = Boolean(decide && when && decide >= when);
  const ready = what.trim() && where.trim() && when && cents > 0 && (squadId || people.length) && !lateDecide;

  const pickFile = (f?: File) => {
    if (!f) return;
    if (!/image\/(png|jpeg|webp)/.test(f.type) || f.size > 6_000_000) return setText("Try a PNG or JPG under 6 MB.");
    const r = new FileReader();
    r.onload = () => setImage({ b64: String(r.result).split(",")[1], mime: f.type, name: f.name });
    r.readAsDataURL(f);
  };

  const read = async (source: string) => {
    try {
      const url = /^https?:\/\/\S+$/.test(source) ? source : undefined;
      const p = await api<Parsed>("POST", "whims/parse", { text: url ? undefined : source || undefined, url, imageBase64: image?.b64, mimeType: image?.mime });
      setParsed(p);
      setWhat(p.what ?? "");
      setWhere(p.place ?? "");
      setWhen(evening(forPicker(p.startsAt)));
      setMode(p.upToCents && !p.priceCents ? "per_person" : "total");
      setPrice(p.priceCents ? String(p.priceCents / 100) : p.upToCents ? String(p.upToCents / 100) : "");
    } catch {
      setWhat(source.slice(0, 60));
    }
    setStep("check");
  };

  // Came from the kitten chat: go straight to reading what was said.
  const started = useRef(false);
  useEffect(() => {
    if (!initialText || started.current) return;
    started.current = true;
    void read(initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, for the text it opened with
  }, []);

  const float = async () => {
    onClose();
    const r = await act(
      "sending",
      () =>
        api<{ squadId: string; friendId?: string | null }>("POST", "whims", {
          ...(people.length ? { friendIds: people } : { squadId }),
          what: what.trim(),
          place: where.trim(),
          whenText: parsed.whenText ?? undefined,
          startsAt: when ? new Date(when).toISOString() : undefined,
          endsAt: when && parsed.endsAt && when === evening(forPicker(parsed.startsAt)) ? parsed.endsAt : undefined,
          priceCents: cents,
          priceMode: mode,
          needAtLeast: needed,
          useSavings: Boolean(party && fromSavings),
          decideBy: decide ? new Date(decide).toISOString() : undefined,
          bookerId: bookerId || undefined,
          imageUrl: parsed.imageUrl ?? undefined,
          sourceUrl: parsed.sourceUrl ?? undefined,
        }),
      { done: "Sent to the kittens." },
    );
    // A short Treat Jar goes to PayPal first; the whim floats when the refill lands.
    if (r?.squadId) router.push(r.friendId ? `/chat/${r.friendId}` : `/squads/${r.squadId}`);
  };

  if (step === "reading")
    return (
      <Sheet onClose={onClose}>
        <div className="flex flex-col items-center py-6">
          <div className="m-scan">
            <LiveKitten look={k?.look} mood="thinking" pose="hold" prop={PROPS.magnifier} size={170} tappable={false} />
          </div>
          <p className="mt-3 font-serif text-[24px] font-bold">Reading that for you...</p>
        </div>
      </Sheet>
    );

  if (step === "check") {
    const sizes = [...new Set([needed, Math.ceil((needed + size) / 2), size])].filter((n) => n >= 2);
    return (
      <Sheet onClose={onClose} title="Is this right?">
        <div className="space-y-3">
          <Field label="What" value={what} maxLength={80} onChange={(e) => setWhat(e.target.value)} />
          <Field label="Where" value={where} maxLength={120} placeholder="Add a place" onChange={(e) => setWhere(e.target.value)} />
          <Field label="When" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <div>
            <Field label={mode === "total" ? "Total price" : "Price per person"} inputMode="decimal" value={price} placeholder="$120" onChange={(e) => setPrice(e.target.value)} />
            <div className="mt-2 flex gap-1.5">
              <Chip on={mode === "total"} onClick={() => setMode("total")}>
                Total
              </Chip>
              <Chip on={mode === "per_person"} onClick={() => setMode("per_person")}>
                Each
              </Chip>
            </div>
            {cents > 0 ? (
              <p key={`${mode}${cents}`} className="pop-in mt-2 rounded-2xl bg-leaf-soft px-3.5 py-2.5 text-[13px] font-semibold leading-[18px]">
                {mode === "per_person" ? `Everyone pays ${money(cents)}, however many go.` : sizes.map((n) => `If ${n} go: ${money(Math.ceil(cents / n))} each`).join(" · ")}
              </p>
            ) : (
              <Soft className="mt-2">Friends&apos; kittens can negotiate this before it becomes a plan.</Soft>
            )}
          </div>

          {!fixed && (
            <div className="space-y-2">
              <Label>Who&apos;s it for</Label>
              {squads && !list.length && <Soft>Start or join a squad first, in the Squads tab.</Soft>}
              <div className="flex flex-wrap gap-1.5">
                {list.map((s) => (
                  <Chip
                    key={s.id}
                    on={!people.length && squadId === s.id}
                    onClick={() => {
                      setPeople([]);
                      setPicked(s.id);
                    }}
                  >
                    {s.name}
                  </Chip>
                ))}
              </div>
              {(friends ?? []).length > 0 && (
                <>
                  <Soft>Or just these friends</Soft>
                  <div className="flex flex-wrap gap-1.5">
                    {friends?.map((f) => (
                      <Chip key={f.id} on={people.includes(f.id)} onClick={() => setPeople((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                        {f.name}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {!people.length && (
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-bold">Need at least</span>
              <Stepper value={needed} min={2} max={Math.max(2, size)} onChange={setNeed} format={(n) => `${n} people`} />
            </div>
          )}
          {party && (
            <div>
              <Label>Pay from</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Chip on={!fromSavings} onClick={() => setFromSavings(false)}>
                  Treat Jar
                </Chip>
                <Chip on={fromSavings} onClick={() => setFromSavings(true)}>
                  {party.name} first
                </Chip>
              </div>
              <Soft className="mt-1.5">{fromSavings ? "Each person's own savings pay first, then their Treat Jar." : "Everyone pays from their Treat Jar."}</Soft>
            </div>
          )}
          <div>
            <Label>Who books it</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip on={bookerId === me?.user.id} onClick={() => setBooker("")}>
                Me
              </Chip>
              {group.map((m) => (
                <Chip key={m.id} on={bookerId === m.id} onClick={() => setBooker(m.id)}>
                  {m.name}
                </Chip>
              ))}
            </div>
          </div>
          <Field label="Answer and pay by (2 days if empty)" type="datetime-local" value={decide} onChange={(e) => setDecide(e.target.value)} />
          {lateDecide && <Soft>The deadline has to be before it happens.</Soft>}
          <Soft>{people.length === 1 ? `It goes to your chat with ${group[0]?.name ?? "them"}.` : people.length ? "Only they see it." : "Only the people chosen see it, and you stay anonymous for now."} Your share is set aside from your Treat Jar now, and each friend&apos;s when they say yes. Once enough say yes, it becomes a plan.</Soft>
          <Btn disabled={!ready} onClick={() => void float()}>
            Float it
          </Btn>
          <Btn kind="plain" onClick={() => setStep("write")}>
            Back
          </Btn>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose} title="New whim">
      <div className="space-y-3">
        <textarea rows={3} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Cabin trip in Dec, $600 in total?" className="w-full resize-none rounded-2xl bg-card p-4 text-[16px] font-semibold shadow-[inset_0_0_0_1.5px_var(--color-line)] outline-none placeholder:font-normal placeholder:text-soft focus:shadow-[inset_0_0_0_2px_var(--color-honey)]" />
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        <Btn kind="plain" onClick={() => file.current?.click()}>
          {image ? image.name : "Attach a screenshot"}
        </Btn>
        <Soft>Or paste a link. I&apos;ll read it and fill in the details.</Soft>
        <Btn
          disabled={!text.trim() && !image}
          onClick={() => {
            setStep("reading");
            void read(text.trim());
          }}
        >
          Next
        </Btn>
      </div>
    </Sheet>
  );
}

function PaidSheet({ onClose, squadId: fixed }: { onClose: () => void; squadId?: string }) {
  const { act } = useMoments();
  const { data: me } = useData<{ user: { id: string } }>("me");
  const [squadId, setSquadId] = useState(fixed ?? "");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [people, setPeople] = useState<string[]>([]);
  const [treat, setTreat] = useState(false);
  const [mine, setMine] = useState(true);
  const [uneven, setUneven] = useState(false);
  const [each, setEach] = useState<Record<string, string>>({});
  const { data: squad } = useData<{ members: Member[] }>(squadId ? `squads/${squadId}` : null);
  const friends = (squad?.members ?? []).filter((m) => m.id !== me?.user.id);
  const cents = toCents(amount);
  const unequal = uneven && !treat;
  // Everyone sharing the cost, in the order they're shown: you first, if you're included.
  const sharing = [...(mine && me ? [{ id: me.user.id, name: "Me" }] : []), ...friends.filter((f) => people.includes(f.id))];
  const assigned = sharing.reduce((a, p) => a + toCents(each[p.id] ?? ""), 0);
  const left = cents - assigned;
  const amountsOk = !unequal || (left === 0 && sharing.every((p) => toCents(each[p.id] ?? "") > 0));

  const send = async () => {
    onClose();
    await act("sending", () => api("POST", "yarn/cards", { squadId, cents, note: note.trim(), forUserIds: people, includePayer: mine, kind: treat ? "treat" : "split", ...(unequal ? { amounts: Object.fromEntries(sharing.map((p) => [p.id, toCents(each[p.id] ?? "")])) } : {}) }), { done: treat ? "Your treat!" : "They'll confirm with one tap." });
  };

  return (
    <Sheet onClose={onClose} title="I paid">
      <div className="space-y-3">
        <Field label="How much" inputMode="decimal" autoFocus placeholder="$48.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="What for" maxLength={80} placeholder="Dinner" value={note} onChange={(e) => setNote(e.target.value)} />
        {!fixed && <SquadPicker value={squadId} onChange={(id) => (setSquadId(id), setPeople([]))} />}
        <div>
          <p className="mb-1 text-[13px] font-bold text-soft">For who</p>
          <div className="flex flex-wrap gap-1.5">
            {friends.map((f) => (
              <Chip key={f.id} on={people.includes(f.id)} onClick={() => setPeople((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                {f.name}
              </Chip>
            ))}
          </div>
        </div>
        <div className="flex gap-1.5">
          <Chip on={!treat} onClick={() => setTreat(false)}>Split it</Chip>
          <Chip on={treat} onClick={() => setTreat(true)}>My treat</Chip>
          {!treat && <Chip on={mine} onClick={() => setMine(!mine)}>Include me</Chip>}
        </div>
        {!treat && (
          <div className="flex gap-1.5">
            <Chip on={!uneven} onClick={() => setUneven(false)}>Equally</Chip>
            <Chip on={uneven} onClick={() => setUneven(true)}>Unequally</Chip>
          </div>
        )}
        {unequal && people.length > 0 && (
          <div className="space-y-2">
            {sharing.map((p) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{p.name}</span>
                <div className="w-28 shrink-0">
                  <Field inputMode="decimal" aria-label={`${p.name}'s part`} placeholder="$0.00" value={each[p.id] ?? ""} onChange={(e) => setEach((x) => ({ ...x, [p.id]: e.target.value }))} />
                </div>
              </div>
            ))}
            <Soft className="text-center">{left === 0 ? "That adds up." : left > 0 ? `${money(left)} still to give out` : `${money(-left)} too much`}</Soft>
          </div>
        )}
        <Btn disabled={!cents || !note.trim() || !people.length || !amountsOk} onClick={() => void send()}>
          Send
        </Btn>
      </div>
    </Sheet>
  );
}

function HelpSheet({ onClose }: { onClose: () => void }) {
  const { act } = useMoments();
  const router = useRouter();
  const { data: me } = useData<{ user: { id: string }; squads: { id: string; kind: string }[] }>("me");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [kind, setKind] = useState<"gift" | "loan" | "either">("either");
  const [people, setPeople] = useState<string[]>([]);
  const first = me?.squads.find((s) => s.kind === "squad")?.id ?? null;
  const { data: squad } = useData<{ members: Member[] }>(first ? `squads/${first}` : null);
  const friends = (squad?.members ?? []).filter((m) => m.id !== me?.user.id);
  const cents = toCents(amount);

  const send = async () => {
    onClose();
    const r = await act("helping", () => api("POST", "help", { cents, note: note.trim(), kind, neededBy: by || null, friendIds: people }), { working: "Asking quietly...", done: "Only they can see this." });
    if (r) router.push("/kitten/lives");
  };

  return (
    <Sheet onClose={onClose} title="Ask friends for help">
      <div className="space-y-3">
        <Field label="How much" inputMode="decimal" autoFocus placeholder="$300" value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Field label="What for" maxLength={140} placeholder="A car repair" value={note} onChange={(e) => setNote(e.target.value)} />
        <Field label="By when (optional)" type="date" value={by} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setBy(e.target.value)} />
        <div className="flex gap-1.5">
          {(["gift", "loan", "either"] as const).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
              {k[0].toUpperCase() + k.slice(1)}
            </Chip>
          ))}
        </div>
        <div>
          <p className="mb-1 text-[13px] font-bold text-soft">Ask</p>
          <div className="flex flex-wrap gap-1.5">
            {friends.map((f) => (
              <Chip key={f.id} on={people.includes(f.id)} onClick={() => setPeople((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))}>
                {f.name}
              </Chip>
            ))}
          </div>
        </div>
        <Soft>It goes privately to the people you pick. It never appears in a squad.</Soft>
        <Btn disabled={!cents || note.trim().length < 2 || !people.length} onClick={() => void send()}>
          Send privately
        </Btn>
      </div>
    </Sheet>
  );
}
