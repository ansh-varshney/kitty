import { validTz } from "./time";

/**
 * When kittens remind people (PRD §B11 "Kittens do the chasing", FR-REMIND-1..2). Pure code: the schedule and the
 * limits live here, so they can't drift between jobs and can be tested without a database.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Days after an "I paid" card was logged. */
export const CARD_DAYS = [2, 5];
/** Days after an Untangle made the payment. */
export const PAY_DAYS = [3, 7];
/** Hours before a plan's deadline. */
export const PLAN_HOURS_LEFT = [48, 12];
/** Hours after the Pounce. */
export const RECEIPT_HOURS = [72, 144];
/** Don't nudge anyone about a plan that has only just appeared. */
export const PLAN_MIN_AGE_MS = 6 * HOUR;
/** After downtime several rounds can be overdue; they still arrive apart, never in one burst. */
export const MIN_GAP_MS = 8 * HOUR;
/** A real Bowl member is overdue only after this long, because PayPal bills them on their own date. */
export const BOWL_OVERDUE_MS = 35 * DAY;

const ms = (t: Date | string | number) => new Date(t).getTime();

export const afterDays = (start: Date | string, days: number[]) => days.map((d) => ms(start) + d * DAY);
export const afterHours = (start: Date | string, hours: number[]) => hours.map((h) => ms(start) + h * HOUR);
export const beforeDeadline = (deadline: Date | string, hours: number[]) => hours.map((h) => ms(deadline) - h * HOUR);

/** The next round to send (1-based), or 0 if nothing is due. Rounds go out in order and stop at the last one. */
export function nextRound(sent: { count: number; lastMs: number | null }, nowMs: number, dueTimes: number[]): number {
  if (sent.count >= dueTimes.length) return 0;
  if (nowMs < dueTimes[sent.count]) return 0;
  if (sent.lastMs != null && nowMs - sent.lastMs < MIN_GAP_MS) return 0;
  return sent.count + 1;
}

/** Is it inside this person's quiet hours? "HH:MM" strings, in their own time zone; a window can cross midnight. */
export function inQuietHours(tz: string, start: string, end: string, now: Date) {
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: validTz(tz), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return start > end ? hm >= start || hm < end : hm >= start && hm < end;
}
