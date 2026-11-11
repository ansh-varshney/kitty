import { describe, expect, it } from "vitest";
import { negotiate, shareOf, whatsWrong, type Person, type Terms } from "./negotiate";

const at = (day: number, hour = 19) => new Date(Date.UTC(2026, 11, day, hour));
const slot = (day: number) => ({ start: at(day), end: at(day, 22) });
const plan = (day: number) => ({ ...slot(day), planId: `p${day}` });
const person = (id: string, o: Partial<Person> = {}): Person => ({ id, plansIn: [], busy: [], spareCents: null, ...o });
const terms: Terms = { window: slot(12), priceCents: 10000, priceMode: "total", ways: 4 };
const notBefore = at(5);

describe("negotiate", () => {
  it("has nothing to ask for when it already fits", () => {
    expect(negotiate({ asker: person("a"), host: person("h"), others: [], terms, notBefore }).kind).toBe("fits");
  });
  it("spots a calendar problem and a budget problem separately", () => {
    expect(whatsWrong(person("a", { plansIn: [plan(12)] }), terms)).toEqual({ time: true, price: false });
    expect(whatsWrong(person("a", { spareCents: 1000 }), terms)).toEqual({ time: false, price: true });
  });
  it("asks for the nearest free day, later first", () => {
    const r = negotiate({ asker: person("a", { plansIn: [plan(12)] }), host: person("h"), others: [], terms, notBefore });
    expect(r.kind === "proposal" && r.ask.window?.start).toEqual(at(13));
  });
  it("prefers the day that suits the most other people", () => {
    const r = negotiate({ asker: person("a", { plansIn: [plan(12)] }), host: person("h"), others: [person("x", { plansIn: [plan(13)] })], terms, notBefore });
    expect(r.kind === "proposal" && r.ask.window?.start).toEqual(at(11));
  });
  it("the host's kitten counters once when the host is busy on that day", () => {
    // Two friends can only do the 13th, so it's asked for first. The host can't, so their kitten counters with the nearest day for both.
    const onlyThe13th = Array.from({ length: 30 }, (_, n) => n + 1).filter((d) => d !== 13).map(plan);
    const r = negotiate({ asker: person("a", { plansIn: [plan(12)] }), host: person("h", { busy: [{ ...slot(13), label: null }] }), others: [person("x", { plansIn: onlyThe13th }), person("y", { plansIn: onlyThe13th })], terms, notBefore });
    expect(r.kind === "proposal" && r.askedFirst?.start).toEqual(at(13));
    expect(r.kind === "proposal" && r.ask.window?.start).toEqual(at(11));
  });
  it("never goes before the deadline", () => {
    const r = negotiate({ asker: person("a", { plansIn: [plan(12), plan(13)] }), host: person("h"), others: [], terms, notBefore: at(12) });
    expect(r.kind === "proposal" && r.ask.window?.start).toEqual(at(14));
  });
  it("asks for what fits the budget, in whole dollars", () => {
    const r = negotiate({ asker: person("a", { spareCents: 2050 }), host: person("h"), others: [], terms, notBefore });
    expect(r.kind === "proposal" && r.ask.priceCents).toBe(8000);
  });
  it("won't ask for more than 25% off: that goes to the people", () => {
    expect(negotiate({ asker: person("a", { spareCents: 1000 }), host: person("h"), others: [], terms, notBefore })).toEqual({ kind: "stuck", on: "price" });
  });
  it("gives up when no day in the next two weeks works", () => {
    const allBooked = Array.from({ length: 40 }, (_, i) => ({ start: at(1 + i), end: at(1 + i, 23), planId: String(i) }));
    expect(negotiate({ asker: person("a", { plansIn: allBooked }), host: person("h"), others: [], terms, notBefore })).toEqual({ kind: "stuck", on: "time" });
  });
  it("uses what the person asked for, even with no clash", () => {
    const r = negotiate({ asker: person("a"), host: person("h"), others: [], terms, notBefore, wish: { window: slot(20), priceCents: 9000 } });
    expect(r.kind === "proposal" && r.ask.window?.start).toEqual(at(20));
    expect(r.kind === "proposal" && r.ask.priceCents).toBe(9000);
  });
  it("works out a share by the ways it's split, or the price each", () => {
    expect(shareOf({ priceMode: "total", ways: 3 }, 10000)).toBe(3334);
    expect(shareOf({ priceMode: "per_person", ways: 3 }, 2500)).toBe(2500);
  });
});
