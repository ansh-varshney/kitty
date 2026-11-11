/**
 * Calendar clashes and picking the best option (PRD §B7 "How the referee chooses",
 * "Changing a plan", §B20 "No double booking", FR-CAL-2/3, FR-NEG-3/5).
 */

export type Window = { start: Date; end: Date };
export type Clash = { hard: { planId: string } | null; soft: { label: string | null } | null };

export function overlaps(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

/** A plan you're already IN = hard "busy" (blocked). A busy time you added = soft (warn). */
export function clash(
  candidate: Window | null,
  plansIn: (Window & { planId: string })[],
  busy: (Window & { label: string | null })[],
): Clash {
  if (!candidate) return { hard: null, soft: null };
  const hard = plansIn.find((p) => overlaps(candidate, p));
  const soft = busy.find((b) => overlaps(candidate, b));
  return { hard: hard ? { planId: hard.planId } : null, soft: soft ? { label: soft.label } : null };
}

export type Option = { key: string; window: Window | null; perPersonCents: number | null };
export type Voter = {
  id: string;
  limitCents: number | null;
  plansIn: (Window & { planId: string })[];
  busy: (Window & { label: string | null })[];
  ranks?: Record<string, number>; // option key → rank (1 = favourite)
};

export type Scored = { key: string; fits: string[]; borda: number; perPersonCents: number | null };

/** Score options: most members fit → best combined ranking (Borda) → lower price. Deterministic. */
export function pickOption(options: Option[], voters: Voter[]): { best: Scored | null; scored: Scored[] } {
  const n = options.length;
  const scored: Scored[] = options.map((o) => {
    const fits = voters
      .filter((v) => !clash(o.window, v.plansIn, []).hard)
      .filter((v) => v.limitCents == null || o.perPersonCents == null || o.perPersonCents <= v.limitCents)
      .map((v) => v.id);
    const borda = voters.reduce((acc, v) => {
      const r = v.ranks?.[o.key];
      return acc + (r ? n - r + 1 : 0);
    }, 0);
    return { key: o.key, fits, borda, perPersonCents: o.perPersonCents };
  });
  const sorted = [...scored].sort(
    (a, b) =>
      b.fits.length - a.fits.length ||
      b.borda - a.borda ||
      (a.perPersonCents ?? Infinity) - (b.perPersonCents ?? Infinity) ||
      a.key.localeCompare(b.key),
  );
  return { best: sorted[0] ?? null, scored };
}

/** Loop guard: at most 2 rounds, one suggestion per kitten per round, never re-propose a rejected option. */
export function acceptSuggestion(opts: {
  round: number;
  fromUser: string;
  key: string;
  alreadyThisRound: string[]; // users who already suggested this round
  seenKeys: string[]; // every option already considered or rejected
}): { ok: true } | { ok: false; why: string } {
  if (opts.round > 2) return { ok: false, why: "negotiation already stopped after 2 rounds" };
  if (opts.alreadyThisRound.includes(opts.fromUser)) return { ok: false, why: "one suggestion per kitten per round" };
  if (opts.seenKeys.includes(opts.key)) return { ok: false, why: "that option was already considered" };
  return { ok: true };
}

// ---------------------------------------------------------------- time zones (pure, Intl only)

export const DEFAULT_TZ = "America/Los_Angeles";

export function validTz(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_TZ;
  }
}

/** Milliseconds the zone is ahead of UTC at instant `t` (negative west of UTC). */
function tzOffsetMs(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(t / 1000) * 1000;
}

/**
 * A wall-clock time in a zone → the real instant. "2026-11-13T19:00" in America/Los_Angeles → 2026-11-14T03:00Z.
 * Strings that already carry Z or an offset are taken as they are. A date with no time = `endOfDay` ? 23:59 : 00:00.
 */
export function zonedToUtc(local: string, tz: string, opts: { endOfDay?: boolean } = {}): Date | null {
  const s = local.trim();
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s) && s.includes("T")) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const hasTime = m[4] != null;
  const [h, mi, sec] = hasTime ? [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)] : opts.endOfDay ? [23, 59, 0] : [0, 0, 0];
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), h, mi, sec);
  const first = wall - tzOffsetMs(wall, validTz(tz));
  return new Date(wall - tzOffsetMs(first, validTz(tz)));
}

/** "Saturday 2026-11-07" in the zone: what the kitten tells the model "today" is. */
export function localToday(tz: string, now = new Date()): { date: string; weekday: string; time: string } {
  const z = validTz(tz);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: z, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: z, weekday: "long" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return { date, weekday, time };
}

/** "1st", "2nd", "23rd", "11th". */
export const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || Math.floor(n / 10) === 1 ? 0 : n % 10]}`;

/**
 * The next time a day of the month comes round, 9am where the person lives (FR-PARTY-7).
 * Today counts as right now, unless `afterToday` is set: then it's next month's.
 */
export function nextDayOfMonth(day: number, tz: string, now = new Date(), opts: { afterToday?: boolean } = {}): Date {
  const [y, m, d] = localToday(tz, now).date.split("-").map(Number);
  if (d === day && !opts.afterToday) return now;
  const later = day > d;
  const year = later || m < 12 ? y : y + 1;
  const month = later ? m : m === 12 ? 1 : m + 1;
  return zonedToUtc(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T09:00`, tz) as Date;
}

/** The weekday (0 = Sunday) in the zone. */
export function nowParts(tz: string, now = new Date()): { weekday: number } {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: validTz(tz), weekday: "short" }).format(now);
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd) };
}
