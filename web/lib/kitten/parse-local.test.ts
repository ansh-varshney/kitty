import { describe, expect, it } from "vitest";
import { parseMoney, parseWhimLocal } from "./parse-local";

// Friday 6 Nov 2026, 11pm in California (= Saturday 07:00 UTC)
const now = new Date("2026-11-07T07:00:00Z");
const tz = "America/Los_Angeles";

describe("reading a whim with code when the AI is down", () => {
  it("cabin weekend dec 12-14, 1200 total", () => {
    expect(parseWhimLocal("cabin weekend dec 12-14, 1200 total", tz, now)).toEqual({
      what: "Cabin weekend",
      priceCents: 120000,
      upToCents: null,
      startsAt: "2026-12-12T08:00:00.000Z",
      endsAt: "2026-12-15T07:59:00.000Z",
      whenText: "dec 12-14",
    });
  });
  it("bowling next friday 7pm? lane is $60 total", () => {
    const w = parseWhimLocal("bowling next friday 7pm? lane is $60 total", tz, now);
    expect([w.what, w.priceCents, w.startsAt]).toEqual(["Bowling", 6000, "2026-11-14T03:00:00.000Z"]);
  });
  it("per-person amounts and default times", () => {
    const w = parseWhimLocal("sushi dinner saturday, around $40 a person", tz, now);
    expect([w.what, w.upToCents, w.priceCents, w.startsAt]).toEqual(["Sushi dinner", 4000, null, "2026-11-08T03:00:00.000Z"]);
    expect(parseWhimLocal("Bowling Friday 7pm, about $20 each", tz, now).upToCents).toBe(2000);
  });
  it("money: dates, times and counts are not money", () => {
    expect(parseMoney("dec 12-14 for 6 people at 7pm")).toEqual({ priceCents: null, upToCents: null });
    expect(parseMoney("$1,200 for the cabin")).toEqual({ priceCents: 120000, upToCents: null });
    expect(parseMoney("tacos 60 bucks")).toEqual({ priceCents: 6000, upToCents: null });
    expect(parseMoney("$12.50 each")).toEqual({ priceCents: null, upToCents: 1250 });
  });
  it("no date or price: just a title", () => {
    expect(parseWhimLocal("let's do karaoke", tz, now)).toEqual({ what: "Karaoke", startsAt: null, endsAt: null, whenText: null, priceCents: null, upToCents: null });
  });
  it("a weekday said on that same day means today; 'next' means a week later", () => {
    const satMorning = new Date("2026-11-07T17:00:00Z"); // Saturday 9am in California
    expect(parseWhimLocal("sushi dinner saturday night, $40 each", tz, satMorning)).toMatchObject({ what: "Sushi dinner", startsAt: "2026-11-08T03:00:00.000Z" });
    expect(parseWhimLocal("brunch next saturday", tz, satMorning).startsAt).toBe("2026-11-14T18:00:00.000Z");
  });
});

