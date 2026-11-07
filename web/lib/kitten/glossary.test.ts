import { describe, expect, it } from "vitest";
import { explainTerm } from "./glossary";

describe("kitten explains Kitty's own words from the glossary, not the model", () => {
  it("answers term questions", () => {
    expect(explainTerm("what does paw up mean?")).toMatch(/raising your limit/);
    expect(explainTerm("explain the Pounce")).toMatch(/booker is paid first/);
    expect(explainTerm("what's a whim")).toMatch(/idea for a plan/);
    expect(explainTerm("whats free hand?")).toMatch(/permission, not money/);
  });
  it("leaves other messages to the chat", () => {
    expect(explainTerm("pounce on the cabin now")).toBeNull();
    expect(explainTerm("how much is in my treat jar?")).toBeNull();
    expect(explainTerm("hey mochi")).toBeNull();
  });
});
