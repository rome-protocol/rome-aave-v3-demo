import { describe, expect, it } from "vitest";

import {
  MAX_COLLATERAL_ASSETS_FOR_BORROW,
  checkCollateralLimit,
  countCollateralAssets,
} from "./collateral-limit";
import type { UserPosition } from "./types";

const pos = (o: Partial<UserPosition> = {}): UserPosition => ({
  walletBalance: 0,
  suppliedBalance: 1,
  debtBalance: 0,
  isCollateral: true,
  borrowMode: null,
  ...o,
});

const four = { wUSDC: pos(), wETH: pos(), wSOL: pos(), wBTC: pos() };
const three = { wETH: pos(), wSOL: pos(), wBTC: pos() };

describe("collateral limit", () => {
  it("limit is 3", () => {
    expect(MAX_COLLATERAL_ASSETS_FOR_BORROW).toBe(3);
  });

  it("counts only supplied reserves switched on as collateral", () => {
    expect(
      countCollateralAssets({
        a: pos(),
        b: pos({ isCollateral: false }),
        c: pos({ suppliedBalance: 0 }),
      }),
    ).toBe(1);
    expect(countCollateralAssets(undefined)).toBe(0);
  });

  it("blocks borrow with 4 collateral assets", () => {
    const r = checkCollateralLimit({ mode: "borrow", positions: four });
    expect(r.blocked).toBe(true);
    expect(r.message).toContain("up to 3 collateral assets");
  });

  it("allows borrow with 3 collateral assets", () => {
    expect(checkCollateralLimit({ mode: "borrow", positions: three }).blocked).toBe(false);
  });

  it("blocks withdraw only while the user has debt", () => {
    const withDebt = { ...four, wDAI: pos({ isCollateral: false, suppliedBalance: 0, debtBalance: 5 }) };
    expect(checkCollateralLimit({ mode: "withdraw", positions: withDebt }).blocked).toBe(true);
    expect(checkCollateralLimit({ mode: "withdraw", positions: four }).blocked).toBe(false);
  });

  it("never blocks supply or repay", () => {
    const withDebt = { ...four, wDAI: pos({ debtBalance: 5 }) };
    expect(checkCollateralLimit({ mode: "supply", positions: withDebt }).blocked).toBe(false);
    expect(checkCollateralLimit({ mode: "repay", positions: withDebt }).blocked).toBe(false);
  });

  it("limit can be lifted via max", () => {
    expect(checkCollateralLimit({ mode: "borrow", positions: four, max: 4 }).blocked).toBe(false);
  });
});
