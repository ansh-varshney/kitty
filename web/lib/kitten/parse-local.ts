import { localToday, nowParts, zonedToUtc } from "../referee/time";

/**
 * Reads a plain-text whim with code, no AI (Phase 1 finding: when Gemini was overloaded, "cabin weekend dec 12-14,
 * 1200 total" came back with no price or dates). The AI result wins where it has a value; this fills the gaps,
 * and stands alone when the AI is down.
 */
export type LocalWhim = { what: string; startsAt: string | null; endsAt: string | null; priceCents: number | null; upToCents: number | null; whenText: string | null };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES: [RegExp, number][] = [
  [/^sun/, 0],
  [/^mon/, 1],
  [/^tue/, 2],
  [/^wed/, 3],
  [/^thu/, 4],
  [/^fri/, 5],
  [/^sat/, 6],
];
const PER_PERSON = /^\s*(each|pp|per person|per head|a head|a person|\/person|\/head|apiece|a pop)\b/i;
const MONEY_WORD = /^\s*(dollars?|bucks|usd)\b/i;
const TOTAL_WORD = /^\s*(total|in total|altogether|all in|for (all|everyone|the group|us|the lane|the cabin|the place|it))\b/i;

const pad = (n: number) => String(n).padStart(2, "0");

export function parseMoney(text: string): { priceCents: number | null; upToCents: number | null } {
  const re = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s?k\b)?/g;
  for (const m of text.matchAll(re)) {
    const after = text.slice(m.index! + m[0].length);
    const before = text.slice(Math.max(0, m.index! - 1), m.index!);
    if (/[-\/:]/.test(before) || /^\s*(?:-|–|to)\s*\d/.test(after) || /^\s*(am|pm|st|nd|rd|th|:)/i.test(after)) continue; // dates, times
    const hasDollar = Boolean(m[1]);
    const word = MONEY_WORD.exec(after);
    const rest = word ? after.slice(word[0].length) : after;
    const per = PER_PERSON.test(rest);
    const total = TOTAL_WORD.test(rest);
    if (!hasDollar && !word && !per && !total) continue; // a bare number (a date, a count) is not money
    let cents = Number(m[2].replace(/,/g, "")) * 100 + (m[3] ? Number(m[3].padEnd(2, "0")) : 0);
    if (m[4]) cents *= 1000;
    if (cents <= 0 || cents > 5_000_000) continue;
    return per ? { priceCents: null, upToCents: cents } : { priceCents: cents, upToCents: null };
  }
  return { priceCents: null, upToCents: null };
}

export function parseWhen(text: string, tz: string, now = new Date()): { startsAt: string | null; endsAt: string | null; whenText: string | null; spans: [number, number][] } {
  const t = text.toLowerCase();
  const spans: [number, number][] = [];
  const today = localToday(tz, now);
  const [y, mo, d] = today.date.split("-").map(Number);
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(noon)\b/.exec(t);
  let hh: number | null = null;
  let mm = 0;
  if (time) {
    spans.push([time.index, time.index + time[0].length]);
    if (time[4]) hh = 12;
    else {
      hh = Number(time[1]) % 12 + (time[3] === "pm" ? 12 : 0);
      mm = Number(time[2] ?? 0);
    }
  } else if (/\b(dinner|night|tonight|evening|drinks)\b/.test(t)) hh = 19;
  else if (/\b(lunch|afternoon)\b/.test(t)) hh = 13;
  else if (/\b(brunch|morning|breakfast)\b/.test(t)) hh = 10;
  const at = (date: string, endOfDay = false) => {
    const local = hh != null && !endOfDay ? `${date}T${pad(hh)}:${pad(mm)}` : date;
    return zonedToUtc(local, tz, { endOfDay })?.toISOString() ?? null;
  };

  // "dec 12-14", "december 12", "Dec 3rd to 5th"
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to)\s*(\d{1,2})(?:st|nd|rd|th)?)?\b/.exec(t);
  if (md) {
    spans.push([md.index, md.index + md[0].length]);
    const month = MONTHS.indexOf(md[1].slice(0, 3)) + 1;
    let year = y;
    if (month < mo || (month === mo && Number(md[2]) < d)) year += 1; // already past this year → next year
    const start = `${year}-${pad(month)}-${pad(Number(md[2]))}`;
    const end = md[3] ? `${year}-${pad(month)}-${pad(Number(md[3]))}` : null;
    return { startsAt: at(start), endsAt: end ? at(end, true) : null, whenText: md[0], spans };
  }

  // "tonight", "today", "tomorrow", "this friday", "next sat"
  let offset: number | null = null;
  let label: RegExpExecArray | null = /\b(tonight|today)\b/.exec(t);
  if (label) offset = 0;
  else if ((label = /\btomorrow\b/.exec(t))) offset = 1;
  else if ((label = /\b(?:(this|next)\s+)?(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/.exec(t))) {
    const target = DAY_NAMES.find(([re]) => re.test(label![2]))![1];
    const todayDow = nowParts(tz, now).weekday;
    // "saturday" said on a Saturday means today (if that time has passed, nextIfPast rolls it a week);
    // "next saturday" said on a Saturday means a week from today.
    offset = (target - todayDow + 7) % 7;
    if (offset === 0 && label[1] === "next") offset = 7;
  }
  if (label && offset != null) {
    spans.push([label.index, label.index + label[0].length]);
    const dt = new Date(Date.UTC(y, mo - 1, d + offset));
    const date = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    return { startsAt: at(date), endsAt: null, whenText: label[0], spans };
  }
  return { startsAt: null, endsAt: null, whenText: null, spans };
}

export function parseWhimLocal(text: string, tz: string, now = new Date()): LocalWhim {
  const money = parseMoney(text);
  const when = parseWhen(text, tz, now);
  // The title: the first clause, minus the date/time words, the money and filler.
  let head = text.split(/[,?!\n]|\s[-–]\s/)[0];
  for (const [a, b] of [...when.spans].sort((x, y) => y[0] - x[0])) if (a < head.length) head = head.slice(0, a) + " " + head.slice(Math.min(b, head.length));
  head = head
    .replace(/\$?\s?\d[\d,.]*\s*(k\b)?\s*(dollars?|bucks|usd)?\s*(each|pp|per person|total)?/gi, " ")
    .replace(/\b(this|next|on|at|for|around|about|like|maybe|who'?s in|anyone|let'?s|we should|go to|do|night|evening|morning|afternoon|tonight|today|tomorrow|weekend plan)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const what = head ? head[0].toUpperCase() + head.slice(1, 40) : "Something fun";
  return { what, startsAt: when.startsAt, endsAt: when.endsAt, whenText: when.whenText, ...money };
}
