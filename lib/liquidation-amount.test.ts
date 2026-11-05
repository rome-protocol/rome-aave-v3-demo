import { describe, expect, it } from "vitest";
import { defaultDebtUsd, previewCollateral, toTokenString, type LiquidationPosition } from "./liquidation-amount";

const base: LiquidationPosition = { hf: 0.99, totalDebtUsd: 10_000, debtAssetUsd: 10_000, collatUsd: 20_000, bonusPct: 0.05 };

describe("defaultDebtUsd", () => {
  it("repays half the total debt when the position is large and HF is 0.95-1", () => {
    expect(defaultDebtUsd(base)).toEqual({ usd: 5_000, full: false });
  });

  it("repays the full debt when HF <= 0.95", () => {
    expect(defaultDebtUsd({ ...base, hf: 0.9 })).toEqual({ usd: 10_000, full: true });
  });

  it("repays the full debt when the debt is under $2,000 (the live demo positions)", () => {
    expect(defaultDebtUsd({ ...base, totalDebtUsd: 5, debtAssetUsd: 5, collatUsd: 4 })).toEqual({ usd: 5, full: true });
  });

  it("repays the full debt when the collateral is under $2,000", () => {
    expect(defaultDebtUsd({ ...base, collatUsd: 1_999 })).toEqual({ usd: 10_000, full: true });
  });

  it("uses half of the TOTAL debt, capped at the asset's own debt", () => {
    const r = defaultDebtUsd({ ...base, totalDebtUsd: 30_000, debtAssetUsd: 10_000, collatUsd: 50_000 });
    expect(r).toEqual({ usd: 10_000, full: true });
  });

  it("lowers the amount to leave $1,000 of debt instead of raising it past the half cap", () => {
    // half of 4,000 = 2,000 leaves 2,000: fine
    expect(defaultDebtUsd({ ...base, totalDebtUsd: 4_000, debtAssetUsd: 4_000, collatUsd: 9_000 })).toEqual({ usd: 2_000, full: false });
    // 2,000 of 3,800 total: half = 1,900 would leave 100, so repay about 995 and 1,005 stays
    const r = defaultDebtUsd({ ...base, totalDebtUsd: 3_800, debtAssetUsd: 2_000, collatUsd: 9_000 });
    expect(r.full).toBe(false);
    expect(r.usd).toBeCloseTo(995);
  });

  it("two-asset debt: 2,400 + 1,600 with 4,100 collateral repays about 1,395 of the larger asset", () => {
    const r = defaultDebtUsd({ ...base, totalDebtUsd: 4_000, debtAssetUsd: 2_400, collatUsd: 4_100 });
    expect(r.full).toBe(false);
    expect(r.usd).toBeCloseTo(1_395);
  });

  it("lowers the amount to leave $1,000 of collateral", () => {
    const r = defaultDebtUsd({ ...base, totalDebtUsd: 18_000, debtAssetUsd: 18_000, collatUsd: 10_000 });
    // half = 9,000 would seize 9,450 and leave 550, so (10,000 - 1,005) / 1.05
    expect(r.full).toBe(false);
    expect(r.usd).toBeCloseTo(8_995 / 1.05);
  });

  it("every partial default respects the half cap and both $1,000 leftovers", () => {
    const cases: LiquidationPosition[] = [
      base,
      { ...base, totalDebtUsd: 3_800, debtAssetUsd: 2_000, collatUsd: 9_000 },
      { ...base, totalDebtUsd: 18_000, debtAssetUsd: 18_000, collatUsd: 10_000 },
      { ...base, totalDebtUsd: 4_000, debtAssetUsd: 2_400, collatUsd: 4_100 },
      { ...base, totalDebtUsd: 20_000, debtAssetUsd: 20_000, collatUsd: 10_500 },
      { ...base, totalDebtUsd: 5_000, debtAssetUsd: 5_000, collatUsd: 2_000 },
    ];
    for (const c of cases) {
      const r = defaultDebtUsd(c);
      expect(r.full).toBe(false);
      expect(r.usd).toBeLessThanOrEqual(c.totalDebtUsd / 2);
      expect(c.debtAssetUsd - r.usd).toBeGreaterThanOrEqual(1_000);
      expect(c.collatUsd - r.usd * (1 + c.bonusPct)).toBeGreaterThanOrEqual(1_000);
    }
  });
});

describe("toTokenString", () => {
  it("keeps sub-token precision (0.0005 ETH is not '0')", () => {
    expect(toTokenString(1.5, 3000, 18, false)).toBe("0.0005");
  });

  it("rounds a full close up with headroom, never down", () => {
    expect(toTokenString(5, 1, 6, true)).toBe("5.05");
  });

  it("rounds a partial close down", () => {
    expect(toTokenString(2.999999999, 1, 6, false)).toBe("2.999999");
  });

  it("does not strip zeros from whole numbers", () => {
    expect(toTokenString(100, 1, 0, false)).toBe("100");
  });

  it("returns 0 for a missing price", () => {
    expect(toTokenString(5, 0, 6, true)).toBe("0");
  });
});

describe("previewCollateral", () => {
  it("adds the bonus when the borrower holds enough", () => {
    const r = previewCollateral(100, 0.05, 1_000, 2);
    expect(r.outUsd).toBeCloseTo(105);
    expect(r.bonusUsd).toBeCloseTo(5);
    expect(r.tokens).toBeCloseTo(52.5);
    expect(r.capped).toBe(false);
  });

  it("caps at the borrower's collateral (the $3,150 vs $4 case)", () => {
    const r = previewCollateral(3_000, 0.05, 4, 3_000);
    expect(r.outUsd).toBe(4);
    expect(r.tokens).toBeCloseTo(4 / 3_000);
    expect(r.capped).toBe(true);
  });
});
