"use client";

import { useState, type ReactNode } from "react";
import { Kitten, PROPS } from "@/components/kitten/Kitten";
import { ACCESSORIES, EYES, EYE_COLOURS, FURS, LABELS, MOODS, PALETTES, PATTERNS, PERSONALITIES, POSES, randomLook, type KittenLook, type Mood, type Pose } from "@/lib/kitten/looks";

const NIGHT = "linear-gradient(180deg, #1B1640 0%, #2E2566 60%, #463A8C 100%)";
const CREAM = "#FBF5EA";
const INK = "#2A2245";

function Chip({ on, onClick, children, swatch }: { on: boolean; onClick: () => void; children: ReactNode; swatch?: string }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold transition"
      style={{ background: on ? INK : "#fff", color: on ? "#fff" : INK, border: `2px solid ${on ? INK : "#E6DCCB"}`, boxShadow: on ? "none" : "0 2px 0 #E6DCCB" }}
    >
      {swatch && <span className="inline-block h-4 w-4 rounded-full" style={{ background: swatch, border: "1.5px solid rgba(0,0,0,.25)" }} />}
      {children}
    </button>
  );
}

function Row({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-5" style={{ boxShadow: "0 2px 0 #E6DCCB" }}>
      <h2 className="text-lg font-bold" style={{ color: INK }}>
        {title}
      </h2>
      {note && <p className="mb-3 text-sm" style={{ color: "#6B6488" }}>{note}</p>}
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </section>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      {children}
      <span className="text-xs font-semibold" style={{ color: "#6B6488" }}>
        {label}
      </span>
    </div>
  );
}

const SQUAD: { name: string; look: KittenLook }[] = [
  { name: "Mochi", look: { fur: "ginger", pattern: "tabby", accessory: "bell", eyes: "amber" } },
  { name: "Biscuit", look: { fur: "cocoa", pattern: "socks", accessory: "scarf", eyes: "green" } },
  { name: "Miso", look: { fur: "midnight", pattern: "plain", accessory: "glasses", eyes: "amber" } },
  { name: "Pickles", look: { fur: "snow", pattern: "patches", accessory: "bow", eyes: "blue" } },
  { name: "Tofu", look: { fur: "smoke", pattern: "tabby", accessory: "none", eyes: "green" } },
];

export default function KittenLab() {
  const [look, setLook] = useState<KittenLook>(SQUAD[0].look);
  const [mood, setMood] = useState<Mood>("neutral");
  const [breed, setBreed] = useState<string>("siamese");
  const [pose, setPose] = useState<Pose>("sit");
  const [prop, setProp] = useState<keyof typeof PROPS>("magnifier");
  const set = (k: keyof KittenLook, v: string) => setLook((l) => ({ ...l, [k]: v }));

  return (
    <main className="min-h-screen p-6" style={{ background: CREAM, color: INK, fontFamily: "ui-rounded, 'Nunito', system-ui, sans-serif" }}>
      <div className="mx-auto max-w-5xl space-y-5">
        <header>
          <h1 className="text-3xl font-black">Kitten lab</h1>
          <p className="text-sm" style={{ color: "#6B6488" }}>
            One template, a few choices: 6 furs × 4 patterns × 5 accessories × 3 eye colours = 360 kittens. Moods change only the face; poses
            change the body. The same drawing is your chat avatar, your Meows greeting and the kitten in every money moment.
          </p>
        </header>

        {/* Builder */}
        <section className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <div className="flex flex-col gap-4 rounded-3xl p-5" style={{ background: "#fff", boxShadow: "0 2px 0 #E6DCCB" }}>
            <h2 className="text-lg font-bold">Adopt a kitten</h2>
            <p className="-mt-3 text-xs" style={{ color: "#6B6488" }}>
              What the owner picks at sign-up: the look, a name and a personality. Nothing else.
            </p>
            <div className="flex flex-wrap gap-2">
              {FURS.map((f) => (
                <Chip key={f} on={look.fur === f} onClick={() => set("fur", f)} swatch={PALETTES[f].base}>
                  {LABELS[f]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {PATTERNS.map((x) => (
                <Chip key={x} on={look.pattern === x} onClick={() => set("pattern", x)}>
                  {LABELS[x]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {ACCESSORIES.map((x) => (
                <Chip key={x} on={look.accessory === x} onClick={() => set("accessory", x)}>
                  {LABELS[x]}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {EYES.map((x) => (
                <Chip key={x} on={look.eyes === x} onClick={() => set("eyes", x)} swatch={EYE_COLOURS[x]}>
                  {LABELS[x]} eyes
                </Chip>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-bold">Personality (tone of voice only)</span>
              <div className="flex flex-wrap gap-2">
                {PERSONALITIES.map((x) => (
                  <Chip key={x.breed} on={breed === x.breed} onClick={() => setBreed(x.breed)}>
                    {x.label}
                  </Chip>
                ))}
              </div>
              <p className="rounded-2xl px-3 py-2 text-sm" style={{ background: "#F3EADB" }}>
                <b>{PERSONALITIES.find((x) => x.breed === breed)?.label}</b> ({PERSONALITIES.find((x) => x.breed === breed)?.note}): “{PERSONALITIES.find((x) => x.breed === breed)?.sample}”
              </p>
            </div>
            <button
              onClick={() => setLook(randomLook())}
              className="self-start rounded-2xl px-5 py-2.5 text-base font-extrabold text-white"
              style={{ background: "#F0A43A", boxShadow: "0 4px 0 #C67F1F" }}
            >
              Surprise me
            </button>
            <div className="mt-2 rounded-2xl border-2 border-dashed p-3" style={{ borderColor: "#E6DCCB" }}>
              <span className="text-sm font-bold">Set by the app, never by the owner</span>
              <p className="text-xs" style={{ color: "#6B6488" }}>
                Preview only. In the app the mood and pose follow what the kitten is doing (default: neutral, sitting).
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((x) => (
                <Chip key={x} on={mood === x} onClick={() => setMood(x)}>
                  {x}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {POSES.map((x) => (
                <Chip key={x} on={pose === x} onClick={() => setPose(x)}>
                  {x}
                </Chip>
              ))}
            </div>
            {pose === "hold" && (
              <div className="flex flex-wrap gap-2">
                {(Object.keys(PROPS) as (keyof typeof PROPS)[]).map((x) => (
                  <Chip key={x} on={prop === x} onClick={() => setProp(x)}>
                    holds {x}
                  </Chip>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center justify-center rounded-3xl" style={{ background: "#fff", boxShadow: "0 2px 0 #E6DCCB" }}>
              <Kitten look={look} mood={mood} pose={pose} prop={pose === "hold" ? PROPS[prop] : undefined} size={240} animate />
            </div>
            <div className="flex items-center justify-center rounded-3xl" style={{ background: NIGHT }}>
              <Kitten look={look} mood={mood} pose={pose} prop={pose === "hold" ? PROPS[prop] : undefined} size={240} animate />
            </div>
          </div>
        </section>

        <Row title="Fur colours" note="Same pattern and accessory as above.">
          {FURS.map((f) => (
            <Labelled key={f} label={LABELS[f]}>
              <Kitten look={{ ...look, fur: f }} mood="neutral" size={120} />
            </Labelled>
          ))}
        </Row>

        <Row title="Patterns">
          {PATTERNS.map((x) => (
            <Labelled key={x} label={LABELS[x]}>
              <Kitten look={{ ...look, pattern: x }} mood="neutral" size={130} />
            </Labelled>
          ))}
        </Row>

        <Row title="Accessories (pick one)">
          {ACCESSORIES.map((x) => (
            <Labelled key={x} label={LABELS[x]}>
              <Kitten look={{ ...look, accessory: x }} mood="happy" size={130} />
            </Labelled>
          ))}
        </Row>

        <Row title="Eye colours" note="Close-up, the way it shows in chat.">
          {EYES.map((x) => (
            <Labelled key={x} label={LABELS[x]}>
              <div className="overflow-hidden rounded-full" style={{ background: "#F3EADB" }}>
                <Kitten look={{ ...look, eyes: x }} view="head" mood="neutral" size={96} />
              </div>
            </Labelled>
          ))}
        </Row>

        <Row title="Moods (face only)" note="Picked by what the message is about: news, a question, something urgent, nothing to do, a win.">
          {MOODS.map((m) => (
            <Labelled key={m} label={m}>
              <div className="overflow-hidden rounded-full" style={{ background: "#F3EADB" }}>
                <Kitten look={look} view="head" mood={m} size={88} />
              </div>
            </Labelled>
          ))}
        </Row>

        <Row title="Poses (for money moments)" note="Hold takes a prop: reading a screenshot, a Meows letter, a coin, yarn, a gift.">
          {POSES.filter((x) => x !== "hold").map((x) => (
            <Labelled key={x} label={x}>
              <Kitten look={look} pose={x} mood={x === "pounce" ? "happy" : x === "wave" ? "happy" : "neutral"} size={140} />
            </Labelled>
          ))}
          {(Object.keys(PROPS) as (keyof typeof PROPS)[]).map((x) => (
            <Labelled key={x} label={`hold: ${x}`}>
              <Kitten look={look} pose="hold" prop={PROPS[x]} mood={x === "magnifier" ? "thinking" : "happy"} size={140} />
            </Labelled>
          ))}
        </Row>

        {/* How it's used */}
        <section className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3 rounded-3xl bg-white p-5" style={{ boxShadow: "0 2px 0 #E6DCCB" }}>
            <h2 className="text-lg font-bold">In chat and Meows</h2>
            <div className="flex items-end gap-3">
              <div className="shrink-0 overflow-hidden rounded-full" style={{ background: "#F3EADB" }}>
                <Kitten look={look} view="head" mood="happy" size={44} />
              </div>
              <div className="rounded-2xl rounded-bl-md px-4 py-2.5 text-sm" style={{ background: "#F3EADB" }}>
                <b>Mochi</b>: I asked Biscuit if Sam&apos;s free Saturday. She&apos;s in.
              </div>
            </div>
            <div className="flex items-end gap-3">
              <div className="shrink-0 overflow-hidden rounded-full" style={{ background: "#EDE7F7" }}>
                <Kitten look={SQUAD[1].look} view="head" mood="thinking" size={44} />
              </div>
              <div className="rounded-2xl rounded-bl-md px-4 py-2.5 text-sm" style={{ background: "#EDE7F7" }}>
                <b>Biscuit</b> (Sam&apos;s kitten): Is the cabin still on for the 12th?
              </div>
            </div>
            <div className="flex items-center gap-4 rounded-2xl p-4" style={{ background: NIGHT, color: "#fff" }}>
              <Kitten look={look} view="bust" pose="hold" prop={PROPS.letter} mood="happy" size={110} animate />
              <div>
                <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "#F7C873" }}>
                  Meows · Sunday
                </div>
                <div className="text-lg font-black">Morning! 3 things need you.</div>
                <div className="text-sm opacity-80">Pay up for the cabin, confirm a coffee card, and Zoe&apos;s birthday is close.</div>
              </div>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-3xl" style={{ background: NIGHT, minHeight: 300 }}>
            <div className="absolute left-5 top-4 text-white">
              <div className="text-lg font-bold">Weekend Crew&apos;s rooftop</div>
              <div className="text-sm opacity-75">Each friend&apos;s own kitten</div>
            </div>
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice" aria-hidden>
              <circle cx={330} cy={60} r={26} fill="#FCE9B8" />
              <circle cx={340} cy={52} r={26} fill="#2E2566" opacity={0.0} />
              {[[40, 70], [90, 40], [150, 90], [210, 50], [260, 100], [370, 120], [300, 30], [20, 130]].map(([x, y]) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={1.6} fill="#fff" opacity={0.8} />
              ))}
              <path d="M0 236 L 400 236 L 400 300 L 0 300 Z" fill="#7A3B4F" />
              <path d="M0 236 L 400 236" stroke="#5B2A3B" strokeWidth={6} />
              <g fill="#8E4A5F">
                {Array.from({ length: 14 }, (_, i) => (
                  <path key={i} d={`M${i * 30} 246 q15 12 30 0`} fill="none" stroke="#6A3245" strokeWidth={3} />
                ))}
              </g>
              <rect x={318} y={182} width={26} height={56} fill="#6A3245" />
              <rect x={314} y={176} width={34} height={10} rx={2} fill="#5B2A3B" />
            </svg>
            <div className="absolute inset-x-0 flex items-end justify-center" style={{ bottom: 58 }}>
              {SQUAD.map((s, i) => (
                <div key={s.name} className="flex flex-col items-center" style={{ marginLeft: i ? -18 : 0 }}>
                  <Kitten look={s.look} mood={i === 2 ? "sleepy" : "happy"} pose={i === 2 ? "sleep" : i === 0 ? "wave" : "sit"} size={92} animate={i === 0} />
                </div>
              ))}
            </div>
            <div className="absolute inset-x-0 bottom-4 flex justify-center gap-6 text-xs font-bold text-white/80">
              {SQUAD.map((s) => (
                <span key={s.name}>{s.name}</span>
              ))}
            </div>
          </div>
        </section>

        <Row title="A squad at random" note="Twelve random looks: kittens in a squad should be easy to tell apart.">
          {Array.from({ length: 12 }, (_, i) => (
            <Kitten key={i} look={randomLook((i + 1) / 13)} mood={MOODS[i % MOODS.length]} size={92} />
          ))}
        </Row>
      </div>
    </main>
  );
}
