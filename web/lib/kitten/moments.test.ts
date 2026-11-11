import { describe, expect, it } from "vitest";
import { CALM, MOMENTS, kittenForEvent } from "./moments";
import { normalizeLook, randomLook, FURS } from "./looks";

describe("kitten mood and pose follow what it's doing (never chosen by the owner)", () => {
  it("defaults to calm: neutral and sitting", () => {
    expect(kittenForEvent("something.new")).toEqual(CALM);
    expect(kittenForEvent("chat.message")).toEqual(CALM);
  });
  it("leaps at a Pounce, is proud when it's settled, alert when something needs you", () => {
    expect(kittenForEvent("pounce.charged")).toEqual(MOMENTS.pounce);
    expect(kittenForEvent("plan.settled").mood).toBe("proud");
    expect(kittenForEvent("yarn.clear").mood).toBe("proud");
    expect(kittenForEvent("pawup.asked").mood).toBe("alert");
    expect(kittenForEvent("yarn.reminder").mood).toBe("alert");
  });
  it("holds the right thing for the moment", () => {
    expect(kittenForEvent("receipt.read")).toMatchObject({ pose: "hold", prop: "magnifier" });
    expect(kittenForEvent("yarn.untangle")).toMatchObject({ prop: "yarn" });
    expect(kittenForEvent("catnip.joined")).toMatchObject({ prop: "gift" });
    expect(kittenForEvent("party.saved")).toMatchObject({ prop: "coin" });
  });
  it("stays calm (no shame) when a plan goes on ice, fades or is cancelled", () => {
    for (const t of ["plan.on_ice", "whim.faded", "plan.cancelled", "paw.released", "whim.withdrawn"]) expect(kittenForEvent(t)).toEqual(CALM);
  });
});

describe("kitten looks", () => {
  it("fills missing or unknown choices with defaults, keeping valid ones", () => {
    expect(normalizeLook({ fur: "midnight", pattern: "nope" })).toEqual({ fur: "midnight", pattern: "tabby", accessory: "bell", eyes: "amber" });
    expect(normalizeLook(null).fur).toBe("ginger");
  });
  it("random looks are spread across fur colours", () => {
    const furs = new Set(Array.from({ length: 30 }, (_, i) => randomLook((i + 1) / 31).fur));
    expect(furs.size).toBeGreaterThanOrEqual(FURS.length - 1);
  });
});
