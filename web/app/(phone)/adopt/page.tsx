"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { api, refreshAll } from "@/lib/client/api";
import { Btn, Chip, Field, H2, Label, Note, Soft, Stepper, Title, Toggle } from "@/components/app/ui";
import { useMoments } from "@/components/app/moments";
import { DEFAULT_LOOK, PERSONALITIES, type KittenLook } from "@/lib/kitten/looks";
import { LookPicker } from "@/components/app/look";

/** Sign-up (PRD §B1, F1): about you, adopt, House Rules, Treat Jar and squad. The kitten is alive from the first moment. */

const GENDERS = [
  ["woman", "Woman"],
  ["man", "Man"],
  ["non-binary", "Non-binary"],
  ["prefer not to say", "Prefer not to say"],
] as const;
const INTERESTS = ["food", "travel", "concerts", "sports", "outdoors", "games", "movies", "nightlife", "shopping", "wellness"];
const NAMES = ["Mochi", "Biscuit", "Miso", "Pickles", "Tofu", "Noodle"];
const JARS = [0, 1000, 2500, 5000];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** An invite link is opened before the PayPal login, so it's kept until sign-up reaches the squad step. */
function savedInvite() {
  try {
    return localStorage.getItem("kitty-invite") ?? "";
  } catch {
    return "";
  }
}

export default function Page() {
  return (
    <Suspense>
      <Adopt />
    </Suspense>
  );
}

function Adopt() {
  const router = useRouter();
  const params = useSearchParams();
  const { act, toast } = useMoments();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [birth, setBirth] = useState("");
  const [share, setShare] = useState(true);
  const [interests, setInterests] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [look, setLook] = useState<KittenLook>(DEFAULT_LOOK);
  const [kName, setKName] = useState("Mochi");
  const [breed, setBreed] = useState<(typeof PERSONALITIES)[number]["breed"]>("siamese");
  const [fun, setFun] = useState(300);
  const [hand, setHand] = useState(20);
  const [help, setHelp] = useState(25);
  const [jar, setJar] = useState(2500);
  const [other, setOther] = useState("");
  const [squadName, setSquadName] = useState("");
  const [code, setCode] = useState(() => params.get("invite") || savedInvite());
  const [joining, setJoining] = useState(() => Boolean(params.get("invite") || savedInvite()));
  const [poke, setPoke] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(800);

  // The kitten being adopted fills about half the screen, whatever size that screen is.
  useEffect(() => {
    if (!root.current) return;
    const watch = new ResizeObserver(([e]) => setHeight(e.contentRect.height));
    watch.observe(root.current);
    return () => watch.disconnect();
  }, []);
  const bigKitten = Math.round(Math.min(300, Math.max(180, height * 0.36)));

  useEffect(() => {
    api<{ user: { name: string; onboarded: boolean } }>("GET", "me")
      .then((m) => {
        if (m.user.onboarded) router.replace("/meows");
        else if (m.user.name && m.user.name !== "New friend") setName(m.user.name);
      })
      .catch(() => router.replace("/"));
  }, [router]);

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPoke((n) => n + 1);
  };
  const birthOk = useMemo(() => /^\d{4}-\d{2}-\d{2}$/.test(birth) && new Date(birth) < new Date(), [birth]);
  const canNext = [Boolean(name.trim() && gender && birthOk && interests.length >= 3), Boolean(kName.trim()), fun > 0, hand <= fun][step];
  const hint = step === 0 && interests.length < 3 && name && gender && birthOk ? `Pick ${3 - interests.length} more` : step === 3 && hand > fun ? "Free hand can't be more than your fun budget." : null;

  const persona = PERSONALITIES.find((p) => p.breed === breed)!;
  const jarExample =
    jar === 0
      ? `With an empty jar, ${kName} asks you before every payment. You can add money later.`
      : hand === 0
        ? `With a free hand of $0, ${kName} asks you before every payment.`
        : `So a $${Math.max(1, Math.min(hand, Math.floor(jar / 100)))} share, ${kName} pays from the jar. A $${hand + 20} share, ${kName} asks you first.`;

  const finish = async () => {
    let inviteFailed = false;
    const done = await act(
      "welcome",
      async () => {
        await api("POST", "onboarding", {
          name: name.trim(),
          gender,
          birthDate: birth,
          shareBirthday: share,
          interests,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          kitten: { name: kName.trim(), breed, look },
          rules: { funBudgetCents: fun * 100, freeHandCents: hand * 100, helpCents: help * 100 },
        });
        if (joining && code.trim()) {
          // A bad invite shouldn't undo a finished sign-up. They can join from Squads.
          await api("POST", "squads/join", { code: code.trim() }).catch(() => {
            inviteFailed = true;
          });
          try {
            localStorage.removeItem("kitty-invite");
          } catch {
            /* nothing to clear */
          }
        } else if (!joining && squadName.trim()) await api("POST", "squads", { name: squadName.trim() });
        return jar > 0 ? api<{ approveUrl?: string }>("POST", "jar/topup", { cents: jar }) : { ok: true };
      },
      { done: `${kName.trim()} is home!` },
    );
    if (done) {
      refreshAll();
      if (inviteFailed) toast("That invite didn't work. You can join from Squads.");
      router.replace("/meows");
    }
  };

  return (
    <div ref={root} className="flex h-full flex-col">
      <div className="relative shrink-0 px-5 pb-8 pt-[max(18px,env(safe-area-inset-top))]" style={{ backgroundImage: `url(/sky/${step === 1 ? "tall" : "band"}.svg)`, backgroundSize: "cover", backgroundPosition: step === 1 ? "center top" : "center bottom" }}>
        {step === 1 ? (
          <div>
            <Label>Step 3 of 5</Label>
            <Title className="mt-0.5 !text-[26px] !leading-8">Adopt your kitten</Title>
            <div className="pop-in flex justify-center">
              <LiveKitten look={look} mood="neutral" size={bigKitten} reactKey={poke} title={kName} />
            </div>
          </div>
        ) : (
          <div className="flex items-end justify-between">
            <div className="pb-2">
              <Label>Step {step + 2} of 5</Label>
              <Title className="mt-1 max-w-[200px]">{["About you", "", "House Rules", "Treat Jar and squad"][step]}</Title>
            </div>
            <LiveKitten look={look} mood="neutral" pose={step === 3 ? "wave" : "sit"} size={120} reactKey={poke} title={kName} />
          </div>
        )}
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`h-2 flex-1 rounded-full transition-colors duration-300 ${i <= step ? "bg-honey" : "bg-[rgba(42,34,69,0.12)]"}`} />
          ))}
        </div>
      </div>

      <div key={step} className="page-in -mt-5 flex-1 space-y-4 overflow-y-auto rounded-t-[28px] bg-paper px-5 pb-6 pt-5 no-scrollbar">
        {step === 0 && (
          <>
            <Field label="Your name" value={name} maxLength={40} onChange={(e) => change(setName)(e.target.value)} placeholder="What friends call you" />
            <div>
              <Label>Gender</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {GENDERS.map(([v, l]) => (
                  <Chip key={v} on={gender === v} onClick={() => change(setGender)(v)}>
                    {l}
                  </Chip>
                ))}
              </div>
            </div>
            <Field label="Birth date" type="date" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => change(setBirth)(e.target.value)} />
            <button type="button" onClick={() => change(setShare)(!share)} className="flex w-full items-center justify-between gap-3 text-left">
              <span className="text-[14px] font-semibold">Let my kitten tell friends&apos; kittens when my birthday is near, for surprises</span>
              <Toggle on={share} />
            </button>
            <div>
              <Label>Interests, pick 3 or more</Label>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[...INTERESTS, ...interests.filter((i) => !INTERESTS.includes(i))].map((i) => (
                  <Chip key={i} on={interests.includes(i)} onClick={() => change(setInterests)(interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i])}>
                    {cap(i)}
                  </Chip>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Field value={custom} maxLength={30} placeholder="Add your own" onChange={(e) => setCustom(e.target.value)} />
                <Btn
                  kind="plain"
                  small
                  disabled={custom.trim().length < 2}
                  onClick={() => {
                    change(setInterests)([...interests, custom.trim().toLowerCase()]);
                    setCustom("");
                  }}
                >
                  Add
                </Btn>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <LookPicker look={look} onChange={(l) => (l.eyes === look.eyes ? change(setLook)(l) : setLook(l))} />
            <Field label="Name" value={kName} maxLength={20} onChange={(e) => change(setKName)(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {NAMES.map((n) => (
                <Chip key={n} on={kName === n} onClick={() => change(setKName)(n)}>
                  {n}
                </Chip>
              ))}
            </div>
            <Row label="Personality">
              {PERSONALITIES.map((p) => (
                <Chip key={p.breed} on={breed === p.breed} onClick={() => change(setBreed)(p.breed)}>
                  {p.label}
                </Chip>
              ))}
            </Row>
            <p key={breed} className="pop-in rounded-2xl bg-inset px-4 py-3 text-[15px] leading-[21px]">{persona.sample}</p>
          </>
        )}

        {step === 2 && (
          <>
            <Soft>These tell {kName} how to look after you. You can change them anytime.</Soft>
            <Rule title="Fun budget" sub={`The most you want to spend with friends in a month. ${kName} warns you before you go over.`}>
              <Stepper value={fun} min={10} max={5000} onChange={change(setFun)} format={(n) => `$${n}`} />
            </Rule>
            <Rule title="Help amount" sub={`When a friend needs money, ${kName} suggests chipping in this much. You always decide.`}>
              <Stepper value={help} min={0} max={1000} onChange={change(setHelp)} format={(n) => `$${n}`} />
            </Rule>
            <Note>{kName} may tell friends&apos; kittens if you&apos;re free, what you&apos;re going to and what you like. Money is never shared.</Note>
          </>
        )}

        {step === 3 && (
          <>
            <div className="space-y-3 rounded-3xl bg-card p-4 shadow-[0_2px_0_var(--color-line)]">
              <div>
                <H2>Treat Jar</H2>
                <Soft className="mt-1">Pocket money for {kName} to pay small things without asking. Yours to take back anytime.</Soft>
              </div>
              <div>
                <Label>How much to put in</Label>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {JARS.map((c) => (
                    <Chip
                      key={c}
                      on={jar === c && !other}
                      onClick={() => {
                        setOther("");
                        change(setJar)(c);
                      }}
                    >
                      ${c / 100}
                    </Chip>
                  ))}
                </div>
                <div className="mt-2">
                  <Field
                    inputMode="decimal"
                    placeholder="Other amount"
                    value={other}
                    onChange={(e) => {
                      setOther(e.target.value);
                      change(setJar)(Math.min(50000, Math.round(Number(e.target.value.replace(/[^0-9.]/g, "")) * 100) || 0));
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-extrabold">Free hand</p>
                  <Soft>What {kName} can pay from the jar without asking. When you tap, the jar pays any amount.</Soft>
                </div>
                <Stepper value={hand} min={0} max={1000} onChange={change(setHand)} format={(n) => `$${n}`} />
              </div>
              <p key={jarExample} className="pop-in rounded-2xl bg-leaf-soft px-3.5 py-2.5 text-[13px] font-semibold leading-[18px]">{jarExample}</p>
            </div>
            <div>
              <H2>Your first squad</H2>
              <Soft className="mt-1">Optional. You can start or join one anytime in Squads.</Soft>
              <div className="mt-2 flex gap-1.5">
                <Chip on={!joining} onClick={() => setJoining(false)}>
                  Start a new squad
                </Chip>
                <Chip on={joining} onClick={() => setJoining(true)}>
                  Join with an invite
                </Chip>
              </div>
              <div className="mt-2">
                {joining ? <Field placeholder="Paste your invite link or code" value={code} onChange={(e) => change(setCode)(e.target.value)} /> : <Field placeholder="Name your squad" maxLength={40} value={squadName} onChange={(e) => change(setSquadName)(e.target.value)} />}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-2 bg-paper px-5 pb-[max(18px,env(safe-area-inset-bottom))] pt-2">
        {hint && <p className="text-center text-[13px] font-bold text-soft">{hint}</p>}
        <div className="flex gap-2">
          {step > 0 && (
            <Btn kind="plain" className="!w-28" onClick={() => setStep(step - 1)}>
              Back
            </Btn>
          )}
          <Btn disabled={!canNext} onClick={() => (step === 3 ? void finish() : setStep(step + 1))}>
            {step === 1 ? `Adopt ${kName || "this kitten"}` : step === 3 ? "Finish" : step === 2 ? "Looks good" : "Next"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <Label>{label}</Label>
    <div className="mt-2 flex flex-wrap items-center gap-1.5">{children}</div>
  </div>
);
const Rule = ({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3">
    <div className="min-w-0">
      <p className="text-[15px] font-extrabold">{title}</p>
      <Soft>{sub}</Soft>
    </div>
    {children}
  </div>
);
