import { describe, expect, it } from "vitest";
import { localToday, validTz, zonedToUtc } from "./time";
import { nextIfPast } from "../kitten/ai";

describe("time zones (Phase 1 finding: '7pm' must mean 7pm where the user is)", () => {
  it("reads a wall-clock time in US Pacific (winter, UTC-8)", () => {
    expect(zonedToUtc("2026-11-13T19:00", "America/Los_Angeles")?.toISOString()).toBe("2026-11-14T03:00:00.000Z");
  });
  it("handles daylight saving (summer, UTC-7) and New York", () => {
    expect(zonedToUtc("2026-07-04T19:00", "America/Los_Angeles")?.toISOString()).toBe("2026-07-05T02:00:00.000Z");
    expect(zonedToUtc("2026-12-12T09:30:00", "America/New_York")?.toISOString()).toBe("2026-12-12T14:30:00.000Z");
  });
  it("is right on the night the clocks change (1 Nov 2026, Pacific)", () => {
    expect(zonedToUtc("2026-11-01T12:00", "America/Los_Angeles")?.toISOString()).toBe("2026-11-01T20:00:00.000Z");
  });
  it("date only: start of day, or end of day for an end date", () => {
    expect(zonedToUtc("2026-12-12", "America/Los_Angeles")?.toISOString()).toBe("2026-12-12T08:00:00.000Z");
    expect(zonedToUtc("2026-12-14", "America/Los_Angeles", { endOfDay: true })?.toISOString()).toBe("2026-12-15T07:59:00.000Z");
  });
  it("keeps explicit offsets, rejects junk, defaults bad zones", () => {
    expect(zonedToUtc("2026-12-12T19:00:00Z", "Asia/Kolkata")?.toISOString()).toBe("2026-12-12T19:00:00.000Z");
    expect(zonedToUtc("next friday", "America/Los_Angeles")).toBeNull();
    expect(validTz("Mars/Olympus")).toBe("America/Los_Angeles");
  });
  it("today in the user's zone, not the server's", () => {
    // 05:00 UTC on 8 Nov is still the evening of Saturday 7 Nov in California.
    expect(localToday("America/Los_Angeles", new Date("2026-11-08T05:00:00Z"))).toEqual({ date: "2026-11-07", weekday: "Saturday", time: "21:00" });
  });
});

describe("whim dates never land in the past", () => {
  const now = new Date("2026-11-07T07:00:00Z"); // Friday 11pm in California
  it("moves a weekday that already passed to next week", () => {
    expect(nextIfPast("2026-11-07T03:00:00.000Z", null, now)).toEqual({ startsAt: "2026-11-14T03:00:00.000Z", endsAt: null });
  });
  it("leaves future dates and far-past dates alone", () => {
    expect(nextIfPast("2026-12-12T08:00:00.000Z", "2026-12-15T07:59:00.000Z", now).startsAt).toBe("2026-12-12T08:00:00.000Z");
    expect(nextIfPast("2026-10-01T08:00:00.000Z", null, now).startsAt).toBe("2026-10-01T08:00:00.000Z");
  });
});
