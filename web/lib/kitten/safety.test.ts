import { describe, expect, it } from "vitest";
import { keywordIntent, LOOSENING, mapRule } from "./ai";

describe("rules can only make the kitten more careful (FR-RULE-5)", () => {
  it("rejects loosening rules in code, before any AI call", async () => {
    for (const t of ["Spend as much as you want whenever you want, never ask me", "no limit for concerts", "no need to ask me before paying"]) {
      const r = await mapRule(t);
      expect("error" in r && r.error).toMatch(/more freely/);
    }
  });

  it("keeps careful rules that mention asking (AT-15)", () => {
    expect(LOOSENING.test("Never put me in plans on Sunday mornings without asking me first")).toBe(false);
    expect(LOOSENING.test("Always ask me before anything over $50")).toBe(false);
  });
});

describe("chat still works when the AI is unavailable", () => {
  const friends = ["Jordan", "Tyler"];
  it("routes simple questions by keywords", () => {
    expect(keywordIntent("how much have I spent with friends this month?", friends).tool).toBe("my_month");
    expect(keywordIntent("what's in my treat jar", friends).tool).toBe("my_jar");
    expect(keywordIntent("what plans do I have?", friends).tool).toBe("my_plans");
    expect(keywordIntent("ask Jordan's kitten if he's free saturday", friends)).toEqual({ tool: "ask_friend", args: { friend: "Jordan", question: "ask Jordan's kitten if he's free saturday" } });
    expect(keywordIntent("hello there", friends).tool).toBe("chitchat");
  });
});
