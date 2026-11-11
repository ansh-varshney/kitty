import { describe, expect, it } from "vitest";
import { nextDayOfMonth, ordinal } from "./time";

/** Picking the day a Kitty Party saving moves (FR-PARTY-7). */
describe("nextDayOfMonth", () => {
  const la = "America/Los_Angeles";
  const noon = new Date("2026-11-09T20:00:00Z"); // Nov 9, noon in Los Angeles

  it("a later day this month is this month, 9am local", () => {
    expect(nextDayOfMonth(15, la, noon).toISOString()).toBe("2026-11-15T17:00:00.000Z");
  });
  it("an earlier day is next month", () => {
    expect(nextDayOfMonth(3, la, noon).toISOString()).toBe("2026-12-03T17:00:00.000Z");
  });
  it("today means right now", () => {
    expect(nextDayOfMonth(9, la, noon)).toBe(noon);
  });
  it("after today's saving, the same day next month", () => {
    expect(nextDayOfMonth(9, la, noon, { afterToday: true }).toISOString()).toBe("2026-12-09T17:00:00.000Z");
  });
  it("December rolls into January", () => {
    expect(nextDayOfMonth(2, la, new Date("2026-12-20T20:00:00Z")).toISOString()).toBe("2027-01-02T17:00:00.000Z");
  });
  it("uses the day where the person lives, not UTC", () => {
    // 03:00 UTC on the 10th is still the 9th in Los Angeles, so the 9th is today.
    const lateEvening = new Date("2026-11-10T03:00:00Z");
    expect(nextDayOfMonth(9, la, lateEvening)).toBe(lateEvening);
  });
});

describe("ordinal", () => {
  it("says days the way people do", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 28].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "28th"]);
  });
});
