import { describe, expect, it } from "vitest";
import { toCents, toPayPalValue, usd } from "./money";
import { env } from "./env";

describe("money (integer cents, FR-SEC-2)", () => {
  it("parses dollars to cents exactly", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("0.1")).toBe(10);
    expect(toCents("680")).toBe(68000);
    expect(toCents(113.33)).toBe(11333);
  });
  it("formats cents for PayPal", () => {
    expect(toPayPalValue(11334)).toBe("113.34");
    expect(toPayPalValue(5)).toBe("0.05");
    expect(usd(100)).toEqual({ currencyCode: "USD", value: "1.00" });
  });
  it("rejects non-money input and fractional cents", () => {
    expect(() => toCents("12.345")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toPayPalValue(1.5)).toThrow();
  });
});

describe("settings", () => {
  it("treats a blank setting as not set", () => {
    const before = process.env.DEV_CONSOLE_KEY;
    process.env.PAYPAL_CLIENT_ID ??= "test-client-id-123";
    process.env.PAYPAL_CLIENT_SECRET ??= "test-client-secret-123";
    process.env.GEMINI_API_KEY ??= "test-gemini-key-123";
    process.env.DEV_CONSOLE_KEY = "";
    try {
      expect(env().DEV_CONSOLE_KEY).toBeUndefined();
    } finally {
      process.env.DEV_CONSOLE_KEY = before;
    }
  });
});
