import { describe, expect, it } from "vitest";
import { afterDays, beforeDeadline, inQuietHours, MIN_GAP_MS, nextRound, PAY_DAYS } from "./reminders";

const DAY = 86_400_000;
const start = new Date("2026-11-01T12:00:00Z");
const at = (days: number) => start.getTime() + days * DAY;
const due = afterDays(start, PAY_DAYS);

describe("nextRound", () => {
  it("sends nothing before the first due time", () => {
    expect(nextRound({ count: 0, lastMs: null }, at(2.9), due)).toBe(0);
  });
  it("sends rounds in order", () => {
    expect(nextRound({ count: 0, lastMs: null }, at(3), due)).toBe(1);
    expect(nextRound({ count: 1, lastMs: at(3) }, at(6), due)).toBe(0);
    expect(nextRound({ count: 1, lastMs: at(3) }, at(7), due)).toBe(2);
  });
  it("stops after the last round, however long it has been", () => {
    expect(nextRound({ count: 2, lastMs: at(7) }, at(300), due)).toBe(0);
  });
  it("keeps overdue rounds apart after downtime", () => {
    expect(nextRound({ count: 0, lastMs: null }, at(30), due)).toBe(1);
    expect(nextRound({ count: 1, lastMs: at(30) }, at(30) + MIN_GAP_MS - 1, due)).toBe(0);
    expect(nextRound({ count: 1, lastMs: at(30) }, at(30) + MIN_GAP_MS, due)).toBe(2);
  });
  it("counts plan rounds down from the deadline", () => {
    const deadline = new Date(at(10));
    const plan = beforeDeadline(deadline, [48, 12]);
    expect(nextRound({ count: 0, lastMs: null }, at(7.9), plan)).toBe(0);
    expect(nextRound({ count: 0, lastMs: null }, at(8.1), plan)).toBe(1);
  });
});

describe("inQuietHours", () => {
  const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 1, h, m));
  it("handles a window that crosses midnight", () => {
    expect(inQuietHours("UTC", "22:00", "08:00", utc(23))).toBe(true);
    expect(inQuietHours("UTC", "22:00", "08:00", utc(7, 59))).toBe(true);
    expect(inQuietHours("UTC", "22:00", "08:00", utc(8))).toBe(false);
    expect(inQuietHours("UTC", "22:00", "08:00", utc(12))).toBe(false);
  });
  it("uses the person's own time zone", () => {
    expect(inQuietHours("Asia/Kolkata", "22:00", "08:00", utc(18))).toBe(true); // 23:30 in India
    expect(inQuietHours("Asia/Kolkata", "22:00", "08:00", utc(6))).toBe(false); // 11:30 in India
  });
});
