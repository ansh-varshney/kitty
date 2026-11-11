import { beforeEach, describe, expect, it, vi } from "vitest";

const captureOrder = vi.fn();
const getOrder = vi.fn();
vi.mock("./sdk", () => ({ orders: () => ({ captureOrder, getOrder }), payments: () => ({}) }));

import { captureCheckout } from "./holds";

const captured = (where: "capture" | "unit" | "neither") => ({
  result: {
    purchaseUnits: [{ customId: where === "unit" ? "jar:abc" : undefined, payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { value: "50.00" }, customId: where === "capture" ? "jar:abc" : undefined }] } }],
  },
});

describe("captureCheckout: which payment was this?", () => {
  beforeEach(() => {
    captureOrder.mockReset();
    getOrder.mockReset();
  });

  it("reads the tag from the capture, where PayPal really puts it", async () => {
    captureOrder.mockResolvedValue(captured("capture"));
    expect(await captureCheckout("O1")).toEqual({ captureId: "CAP1", status: "COMPLETED", cents: 5000, customId: "jar:abc" });
    expect(getOrder).not.toHaveBeenCalled();
  });

  it("asks PayPal for the order if the reply came back without a tag", async () => {
    captureOrder.mockResolvedValue(captured("neither"));
    getOrder.mockResolvedValue(captured("unit"));
    expect((await captureCheckout("O1")).customId).toBe("jar:abc");
  });

  it("treats coming back twice as the same payment, not a failure", async () => {
    captureOrder.mockRejectedValue(Object.assign(new Error("422"), { result: { details: [{ issue: "ORDER_ALREADY_CAPTURED" }] } }));
    getOrder.mockResolvedValue(captured("capture"));
    expect(await captureCheckout("O1")).toMatchObject({ captureId: "CAP1", status: "COMPLETED", customId: "jar:abc" });
  });

  it("still reports a real failure", async () => {
    captureOrder.mockRejectedValue(new Error("INSTRUMENT_DECLINED"));
    await expect(captureCheckout("O1")).rejects.toThrow("INSTRUMENT_DECLINED");
  });
});
