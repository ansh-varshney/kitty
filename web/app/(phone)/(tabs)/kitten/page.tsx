"use client";

import { useState } from "react";
import Link from "next/link";
import { LiveKitten } from "@/components/kitten/LiveKitten";
import { LookPicker } from "@/components/app/look";
import { api, useData } from "@/lib/client/api";
import { useMoments } from "@/components/app/moments";
import { Btn, Card, Chip, Field, Icon, Label, Paper, Scene, Sheet, Soft, Title, Toggle } from "@/components/app/ui";
import { DEFAULT_LOOK, PERSONALITIES, type KittenLook } from "@/lib/kitten/looks";

/** My Kitten (PRD §B22 App structure): your kitten, its rules, its diary and your settings. The Treat Jar lives in My Month. */

type Me = {
  user: { name: string; gender: string | null; birth_date: string | null; share_birthday: boolean; interests: string[]; tz: string; paypal_email: string | null };
  kitten: { name: string; breed: string; look: KittenLook } | null;
};
type Purrs = { purrs: number; tags: { tag: string; private: boolean; about?: { name?: string; about?: string } | string }[] };
type Sheets = null | "look" | "memory" | "profile" | "settings";

export default function Page() {
  const { data: me } = useData<Me>("me");
  const { data: purrs } = useData<Purrs>("purrs");
  const [sheet, setSheet] = useState<Sheets>(null);
  const { act } = useMoments();

  const logout = async () => {
    const out = await act("welcome", () => api("POST", "auth/logout"), { working: "See you soon...", minMs: 900, stop: () => true });
    // A full reload, so nothing of this person's stays in memory for whoever logs in next.
    if (out) window.location.assign("/");
  };
  const k = me?.kitten;
  const persona = PERSONALITIES.find((p) => p.breed === k?.breed);

  const rows: { label: string; sub: string; href?: string; open?: Sheets }[] = [
    { label: "House Rules", sub: "What your kitten may do alone", href: "/kitten/rules" },
    { label: "Kitten Diary", sub: "Everything it did, and why", href: "/kitten/diary" },
    { label: "Nine Lives", sub: "Help asked and given", href: "/kitten/lives" },
    { label: "What I remember", sub: "See it or delete it", open: "memory" },
    { label: "About you", sub: "Name, birthday, interests", open: "profile" },
    { label: "Settings", sub: "Meows, quiet hours, export", open: "settings" },
  ];

  return (
    <>
      <Scene kind="tall" className="!pb-12">
        <div className="flex flex-col items-center">
          <LiveKitten look={k?.look} mood="happy" size={190} title={k?.name} />
          <Title className="mt-1 text-center">{k?.name ?? "..."}</Title>
          {persona && <Soft className="!text-ink">{persona.label} kitten</Soft>}
          <button type="button" onClick={() => setSheet("look")} className="press mt-2 rounded-full bg-card px-4 py-1.5 text-[13px] font-extrabold shadow-[0_2px_0_var(--color-line)]">
            Change look
          </button>
        </div>
      </Scene>
      <Paper className="space-y-3">
        <Card className="flex items-center justify-between gap-3 !bg-lilac-soft">
          <div>
            <Soft>Purrs</Soft>
            <p className="text-[26px] font-extrabold leading-8">{purrs?.purrs ?? 0}</p>
          </div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {purrs?.tags.map((t) => (
              <span key={t.tag} className="pop-in rounded-full bg-card px-2.5 py-1 text-[12px] font-extrabold">
                {t.tag}
              </span>
            ))}
          </div>
        </Card>
        <Link href="/chat" className="block">
          <Btn>Talk to {k?.name ?? "your kitten"}</Btn>
        </Link>
        <div className="space-y-2">
          {rows.map((r, i) => {
            const inner = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16px] font-extrabold">{r.label}</span>
                  <span className="block truncate text-[13px] text-soft">{r.sub}</span>
                </span>
                <Icon i="chev" size={18} />
              </>
            );
            const cls = "press slide-up flex w-full items-center gap-2 rounded-2xl bg-card p-3.5 text-left shadow-[0_2px_0_var(--color-line)]";
            const style = { ["--delay" as string]: `${i * 35}ms` };
            return r.href ? (
              <Link key={r.label} href={r.href} className={cls} style={style}>
                {inner}
              </Link>
            ) : (
              <button key={r.label} type="button" className={cls} style={style} onClick={() => setSheet(r.open ?? null)}>
                {inner}
              </button>
            );
          })}
        </div>
        <Btn kind="soft" onClick={() => void logout()}>
          Log out
        </Btn>
      </Paper>

      {sheet === "look" && k && <LookSheet name={k.name} breed={k.breed} look={k.look} onClose={() => setSheet(null)} />}
      {sheet === "memory" && <MemorySheet name={k?.name ?? "your kitten"} onClose={() => setSheet(null)} />}
      {sheet === "profile" && me && <ProfileSheet me={me} onClose={() => setSheet(null)} />}
      {sheet === "settings" && <SettingsSheet onClose={() => setSheet(null)} />}
    </>
  );
}

function LookSheet({ name: n0, breed: b0, look: l0, onClose }: { name: string; breed: string; look: KittenLook; onClose: () => void }) {
  const { act } = useMoments();
  const [look, setLook] = useState<KittenLook>({ ...DEFAULT_LOOK, ...l0 });
  const [name, setName] = useState(n0);
  const [breed, setBreed] = useState(b0);
  const [poke, setPoke] = useState(0);
  return (
    <Sheet onClose={onClose}>
      <div className="flex justify-center">
        <LiveKitten look={look} mood="happy" size={150} reactKey={poke} title={name} />
      </div>
      <div className="space-y-3">
        <LookPicker
          look={look}
          onChange={(l) => {
            setLook(l);
            setPoke((p) => p + 1);
          }}
        />
        <Field label="Name" maxLength={20} value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <Label>Personality</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PERSONALITIES.map((p) => (
              <Chip
                key={p.breed}
                on={breed === p.breed}
                onClick={() => {
                  setBreed(p.breed);
                  setPoke((x) => x + 1);
                }}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
        <Soft>Your kitten&apos;s rules and money never change with its look.</Soft>
        <Btn
          disabled={!name.trim()}
          onClick={() => {
            onClose();
            void act("welcome", () => api("POST", "me/kitten", { name: name.trim(), breed, look }), { working: "Grooming...", done: "Looking good." });
          }}
        >
          Save
        </Btn>
      </div>
    </Sheet>
  );
}

function MemorySheet({ name, onClose }: { name: string; onClose: () => void }) {
  const { act } = useMoments();
  const { data } = useData<{ memory: string[] }>("kitten/memory");
  const memory = data?.memory ?? [];
  return (
    <Sheet title="What I remember" onClose={onClose}>
      {data && !memory.length && <Soft>Nothing yet. Tell {name} something in chat, and it&apos;ll remember.</Soft>}
      <div className="space-y-1.5">
        {memory.map((m, i) => (
          <div key={m + i} className="flex items-center justify-between gap-2 rounded-2xl bg-card px-3.5 py-2.5 shadow-[0_2px_0_var(--color-line)]">
            <p className="text-[14px]">{m}</p>
            <button type="button" aria-label="Forget" onClick={() => void act("released", () => api("POST", "kitten/memory/forget", { index: i }), { working: "Forgetting...", done: "Forgotten." })}>
              <Icon i="close" size={16} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

const GENDERS = ["woman", "man", "non-binary", "prefer not to say"];

function ProfileSheet({ me, onClose }: { me: Me; onClose: () => void }) {
  const { act } = useMoments();
  const u = me.user;
  const [name, setName] = useState(u.name);
  const [gender, setGender] = useState(u.gender ?? "");
  const [birth, setBirth] = useState(String(u.birth_date ?? "").slice(0, 10));
  const [share, setShare] = useState(u.share_birthday);
  const [interests, setInterests] = useState(u.interests.join(", "));
  const list = interests.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 2);
  return (
    <Sheet title="About you" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <Label>Gender</Label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {GENDERS.map((g) => (
              <Chip key={g} on={gender === g} onClick={() => setGender(g)}>
                {g[0].toUpperCase() + g.slice(1)}
              </Chip>
            ))}
          </div>
        </div>
        <Field label="Birth date" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
        <button type="button" onClick={() => setShare(!share)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="text-[14px] font-semibold">Let friends&apos; kittens know when my birthday is near</span>
          <Toggle on={share} />
        </button>
        <Field label="Interests, separated by commas" value={interests} onChange={(e) => setInterests(e.target.value)} />
        <Btn
          disabled={!name.trim() || !gender || !birth || list.length < 3}
          onClick={() => {
            onClose();
            void act("thinking", () => api("POST", "me/profile", { name: name.trim(), gender, birthDate: birth, shareBirthday: share, interests: list }), { done: "Updated." });
          }}
        >
          Save
        </Btn>
      </div>
    </Sheet>
  );
}

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { act, toast } = useMoments();
  const [meow, setMeow] = useState("09:00");
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("08:00");

  const calendar = async () => {
    const r = await api<{ url: string }>("POST", "calendar/token", {});
    await navigator.clipboard?.writeText(r.url);
    toast("Calendar link copied. Paste it into your calendar app.");
  };

  return (
    <Sheet title="Settings" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Daily Meows at" type="time" value={meow} onChange={(e) => setMeow(e.target.value)} />
        <div className="flex gap-2">
          <Field label="Quiet from" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label="Until" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Soft>Your kitten won&apos;t bother you, or let friends&apos; kittens remind you, in quiet hours.</Soft>
        <Btn
          onClick={() => {
            onClose();
            void act("thinking", () => api("POST", "me/settings", { meowTime: meow, quietStart: start, quietEnd: end, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }), { done: "Saved." });
          }}
        >
          Save
        </Btn>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <a href="/api/v1/export/diary.csv">
            <Btn small kind="plain" className="w-full">
              Download diary
            </Btn>
          </a>
          <a href="/api/v1/export/month.csv">
            <Btn small kind="plain" className="w-full">
              Download month
            </Btn>
          </a>
        </div>
        <Btn kind="plain" onClick={() => void calendar()}>
          Connect my calendar
        </Btn>
      </div>
    </Sheet>
  );
}
