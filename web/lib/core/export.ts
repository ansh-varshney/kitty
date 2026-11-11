import { randomBytes } from "node:crypto";
import { db } from "../db";
import { diary } from "./events";
import { myMonth } from "./mymonth";
import { calendar } from "./month";

/**
 * Export and connect (PRD §B21): CSV of the Kitten Diary and My Month (FR-EXP-3), and a private calendar feed
 * (FR-EXP-2). The remote MCP connector (FR-EXP-1, SHOULD) is deferred: Export is first in the PRD's cut order.
 */

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas (a cell starting with = + - @).
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const row = (cols: unknown[]) => cols.map(cell).join(",");

export async function diaryCsv(userId: string) {
  const d = await db();
  const items = await diary(d, userId, 5000);
  const lines = [row(["time", "what", "by", "amount (USD)", "why", "PayPal ID"])];
  for (const e of items) {
    const cents = (e.payload as { cents?: number }).cents;
    // ISO 8601 UTC, so spreadsheets sort it and nothing depends on the server's locale.
    const what = e.line;
    lines.push(row([new Date(e.createdAt).toISOString(), what, e.actor, cents != null ? (cents / 100).toFixed(2) : "", e.reason ?? "", e.paypalId ?? ""]));
  }
  return lines.join("\r\n");
}

export async function monthCsv(userId: string) {
  const m = await myMonth(userId);
  const usd = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
  const lines = [row(["section", "item", "amount (USD)"])];
  lines.push(row(["meter", "spent", usd(m.money.meter.spentCents)]), row(["meter", "on hold", usd(m.money.meter.committedCents)]), row(["meter", "fun budget", usd(m.money.meter.budgetCents)]));
  for (const [k, v] of Object.entries(m.money.byKind)) lines.push(row(["by kind", k, usd(v)]));
  for (const s of m.money.bySquad) lines.push(row(["by squad", s.squad, usd(s.cents)]));
  lines.push(row(["owed", "you owe", usd(m.money.owed.youOweCents)]), row(["owed", "owed to you", usd(m.money.owed.owedToYouCents)]));
  for (const s of m.money.saved.partySavings) lines.push(row(["saved", `Kitty Party: ${s.squad}`, usd(s.cents)]));
  for (const s of m.money.saved.thisMonth) lines.push(row(["saved", `Put into ${s.name} this month`, usd(s.cents)]));
  lines.push(row(["saved", "Treat Jar", usd(m.money.saved.treatJar.availableCents)]));
  return lines.join("\r\n");
}

/** A private, unguessable link for calendar apps (no login, so it carries only titles and times). */
export async function calendarToken(userId: string, rotate = false) {
  const d = await db();
  const [u] = await d.query<{ calendar_token: string | null }>(`select calendar_token from users where id=$1`, [userId]);
  if (u?.calendar_token && !rotate) return u.calendar_token;
  const token = randomBytes(18).toString("base64url");
  await d.query(`update users set calendar_token=$2 where id=$1`, [userId, token]);
  return token;
}

const ics = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");

export async function calendarFeed(token: string) {
  const d = await db();
  const [u] = await d.query<{ id: string; name: string }>(`select id, name from users where calendar_token=$1`, [token]);
  if (!u || token.length < 16) return null;
  const cal = await calendar(d, u.id);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kitty//Plans//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${esc(`Kitty (${u.name})`)}`];
  const stamp = ics(new Date().toISOString());
  for (const p of cal.plans) {
    if (p.starts_at) {
      const end = p.ends_at ?? new Date(Date.parse(p.starts_at) + 3 * 3600_000).toISOString();
      lines.push("BEGIN:VEVENT", `UID:plan-${p.id}@kitty`, `DTSTAMP:${stamp}`, `DTSTART:${ics(new Date(p.starts_at).toISOString())}`, `DTEND:${ics(new Date(end).toISOString())}`, `SUMMARY:${esc(p.title)}`, "END:VEVENT");
    }
    if (p.status === "open") {
      const at = new Date(p.decide_by).toISOString();
      lines.push("BEGIN:VEVENT", `UID:decide-${p.id}@kitty`, `DTSTAMP:${stamp}`, `DTSTART:${ics(at)}`, `DTEND:${ics(new Date(Date.parse(at) + 15 * 60_000).toISOString())}`, `SUMMARY:${esc(`Decide: ${p.title}`)}`, "END:VEVENT");
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
