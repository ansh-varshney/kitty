import { clash, type Window } from "./time";

/**
 * What a kitten does when its owner taps "negotiate" (PRD §B7, FR-NEG-9..13). Pure code: same facts, same answer.
 *
 * 1. What's wrong for my owner: the time, the price, or both? If nothing is, there's nothing to ask for.
 * 2. Time: the nearest day, same hour, that my owner can do and that suits the most other people.
 * 3. Price: ask for what fits my owner's budget, never more than 25% off, because a bigger cut isn't a negotiation.
 * 4. The host's kitten checks the time against the host's calendar and counters once if it can't.
 * 5. Nothing found: stop, and hand it to the people.
 */

export const MAX_WHIM_CHANGES = 2;
export const MAX_PRICE_CUT = 0.25;
export const SEARCH_DAYS = 14;

export type Person = { id: string; plansIn: (Window & { planId: string })[]; busy: (Window & { label: string | null })[]; spareCents: number | null };
export type Terms = { window: Window | null; priceCents: number; priceMode: "total" | "per_person"; ways: number };
export type Ask = { window?: Window; priceCents?: number };

export type Outcome =
  | { kind: "fits" }
  | { kind: "stuck"; on: "time" | "price" }
  | { kind: "proposal"; ask: Ask; because: { time: boolean; price: boolean }; askedFirst: Window | null; fits: number; of: number };

export const shareOf = (t: Pick<Terms, "priceMode" | "ways">, priceCents: number) => (t.priceMode === "per_person" ? priceCents : Math.ceil(priceCents / Math.max(t.ways, 1)));

const free = (p: Person, w: Window) => {
  const c = clash(w, p.plansIn, p.busy);
  return !c.hard && !c.soft;
};

export function whatsWrong(p: Person, t: Terms) {
  return { time: t.window ? !free(p, t.window) : false, price: p.spareCents != null && shareOf(t, t.priceCents) > p.spareCents };
}

/** The same hour on nearby days, nearest first, later before earlier. Never before `notBefore` (the deadline). */
function nearbyTimes(w: Window, notBefore: Date): Window[] {
  const len = w.end.getTime() - w.start.getTime();
  const out: Window[] = [];
  for (let days = 1; days <= SEARCH_DAYS; days++) {
    for (const sign of [1, -1]) {
      const start = new Date(w.start.getTime() + sign * days * 86400_000);
      if (start >= notBefore) out.push({ start, end: new Date(start.getTime() + len) });
    }
  }
  return out;
}

function bestTime(w: Window, mustFit: Person[], others: Person[], notBefore: Date, skip?: Window): Window | null {
  let best: Window | null = null;
  let score = -1;
  for (const c of nearbyTimes(w, notBefore)) {
    if (skip && c.start.getTime() === skip.start.getTime()) continue;
    if (!mustFit.every((p) => free(p, c))) continue;
    const s = others.filter((p) => free(p, c)).length;
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return best;
}

/** The price that would fit, in whole dollars each. Null if there's no spare money, or the gap is too big to ask for. */
function priceAsk(p: Person, t: Terms): number | null {
  if (p.spareCents == null || p.spareCents <= 0) return null;
  const now = shareOf(t, t.priceCents);
  const target = Math.floor(p.spareCents / 100) * 100;
  if (target <= 0 || target >= now || target < Math.ceil(now * (1 - MAX_PRICE_CUT))) return null;
  return t.priceMode === "per_person" ? target : target * Math.max(t.ways, 1);
}

export function negotiate(input: { asker: Person; host: Person; others: Person[]; terms: Terms; notBefore: Date; wish?: Ask }): Outcome {
  const { asker, host, others, terms, notBefore, wish } = input;
  const wrong = whatsWrong(asker, terms);
  const wantsTime = Boolean(terms.window) && (Boolean(wish?.window) || wrong.time);
  const wantsPrice = wish?.priceCents != null || wrong.price;
  if (!wantsTime && !wantsPrice) return { kind: "fits" };

  const ask: Ask = {};
  let askedFirst: Window | null = null;
  if (wantsTime && terms.window) {
    const first = wish?.window ?? bestTime(terms.window, [asker], [host, ...others], notBefore);
    if (!first) return { kind: "stuck", on: "time" };
    if (free(host, first)) ask.window = first;
    else {
      // The host's kitten counters once: the nearest time that works for both of them.
      const counter = bestTime(terms.window, [asker, host], others, notBefore, first);
      if (!counter) return { kind: "stuck", on: "time" };
      askedFirst = first;
      ask.window = counter;
    }
  }
  if (wantsPrice) {
    const price = wish?.priceCents ?? priceAsk(asker, terms);
    if (price == null) return { kind: "stuck", on: "price" };
    ask.priceCents = price;
  }
  const when = ask.window ?? terms.window;
  const everyone = [asker, host, ...others];
  return { kind: "proposal", ask, because: { time: wantsTime, price: wantsPrice }, askedFirst, fits: when ? everyone.filter((p) => free(p, when)).length : everyone.length, of: everyone.length };
}
