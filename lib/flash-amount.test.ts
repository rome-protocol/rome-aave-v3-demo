import { describe, expect, it } from "vitest";
import { defaultFlashAmount, maxFlashAmount } from "./flash-amount";

describe("defaultFlashAmount", () => {
  it("starts at 1,000 when that much is available", () => {
    expect(defaultFlashAmount(1790, 6)).toBe("1000");
    expect(defaultFlashAmount(82_677.26, 6)).toBe("1000");
  });
  it("uses the whole units available between 1 and 1,000", () => {
    expect(defaultFlashAmount(250.9, 6)).toBe("250");
    expect(defaultFlashAmount(1, 6)).toBe("1");
  });
  it("is never 0 for an asset with less than one unit available: half of it", () => {
    expect(defaultFlashAmount(0.5, 6)).toBe("0.25");
    expect(defaultFlashAmount(0.0139, 18)).toBe("0.00695");
    expect(defaultFlashAmount(0.003, 6)).toBe("0.0015");
  });
  it("is 0 only when nothing is available", () => {
    expect(defaultFlashAmount(0, 6)).toBe("0");
    expect(defaultFlashAmount(-3, 6)).toBe("0");
    expect(defaultFlashAmount(NaN, 6)).toBe("0");
  });
});

describe("maxFlashAmount (the Max button)", () => {
  it("keeps the fraction, cut not rounded, never above what is available", () => {
    expect(maxFlashAmount(1.79, 6)).toBe("1.79");
    expect(maxFlashAmount(0.0139, 18)).toBe("0.0139");
    expect(maxFlashAmount(2.9999999, 6)).toBe("2.999999");
    expect(maxFlashAmount(1000, 6)).toBe("1000");
  });
  it("respects the asset's decimals", () => {
    expect(maxFlashAmount(1.239, 2)).toBe("1.23");
    expect(maxFlashAmount(0.004, 2)).toBe("0");
  });
});
