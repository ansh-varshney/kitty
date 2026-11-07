import { describe, expect, it } from "vitest";
import { generate } from "./gemini";

describe("Gemini fast-first fallback (FR-AI-1, FR-AI-2)", () => {
  it("uses Flash-Lite first for fast tasks", async () => {
    const seen: string[] = [];
    const res = await generate("hi", { impl: async (m) => (seen.push(m), "ok") });
    expect(res.model).toBe("gemini-3.1-flash-lite");
    expect(seen).toEqual(["gemini-3.1-flash-lite"]);
  });

  it("retries a busy model, then falls back to the next one", async () => {
    const seen: string[] = [];
    const res = await generate("hi", {
      impl: async (m) => {
        seen.push(m);
        if (m === "gemini-3.1-flash-lite") throw Object.assign(new Error("503 UNAVAILABLE high demand"), { status: 503 });
        return "ok";
      },
    });
    expect(res.model).toBe("gemini-3.5-flash");
    expect(seen).toEqual(["gemini-3.1-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash"]);
  });

  it("skips a retired model without retrying (404)", async () => {
    const seen: string[] = [];
    await generate("hi", {
      impl: async (m) => {
        seen.push(m);
        if (m === "gemini-3.1-flash-lite") throw Object.assign(new Error("404 NOT_FOUND"), { status: 404 });
        return "ok";
      },
    });
    expect(seen).toEqual(["gemini-3.1-flash-lite", "gemini-3.5-flash"]);
  });

  it("falls back to a template when every model fails", async () => {
    const res = await generate("hi", {
      impl: async () => {
        throw Object.assign(new Error("429 RESOURCE_EXHAUSTED"), { status: 429 });
      },
      template: () => "Mochi is napping. Here's the plain version.",
    });
    expect(res.fallback).toBe(true);
    expect(res.model).toBe("template");
  });
});
