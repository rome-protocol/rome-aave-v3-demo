import { describe, expect, it } from "vitest";

import { checkActionSafety, checkBorrowLiquidity } from "./liquidity-guard";

describe("checkBorrowLiquidity", () => {
  it("permits a borrow strictly below the pool supply", () => {
    const r = checkBorrowLiquidity({ amountHuman: "3.5", symbol: "wUSDC", availableLiquidity: 3.840508, decimals: 6 });
    expect(r.ok).toBe(true);
    expect(r.message).toBeUndefined();
  });

  it("permits exactly-the-cap borrow (Aave's check is >= so the cap is reachable)", () => {
    const r = checkBorrowLiquidity({ amountHuman: "3.840508", symbol: "wUSDC", availableLiquidity: 3.840508, decimals: 6 });
    expect(r.ok).toBe(true);
  });

  it("blocks a borrow that exceeds the pool supply", () => {
    const r = checkBorrowLiquidity({ amountHuman: "5", symbol: "wUSDC", availableLiquidity: 3.840508, decimals: 6 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("wUSDC");
    expect(r.message).toContain("3.840508");
  });

  it("blocks even tiny overage (3.84001 > 3.840508 is false but 3.85 > 3.840508 is true)", () => {
    const tiny = checkBorrowLiquidity({ amountHuman: "3.85", symbol: "wUSDC", availableLiquidity: 3.840508, decimals: 6 });
    expect(tiny.ok).toBe(false);
  });

  it("handles 8-decimal wETH supplies (Wormhole-bridged ETH on Hadrian is 8dec)", () => {
    const ok = checkBorrowLiquidity({ amountHuman: "0.04", symbol: "wETH", availableLiquidity: 0.06261857, decimals: 8 });
    expect(ok.ok).toBe(true);
    const blocked = checkBorrowLiquidity({ amountHuman: "0.1", symbol: "wETH", availableLiquidity: 0.06261857, decimals: 8 });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("0.062619");
    expect(blocked.message).toContain("wETH");
  });

  it("handles 9-decimal wSOL supplies", () => {
    const blocked = checkBorrowLiquidity({ amountHuman: "0.5", symbol: "wSOL", availableLiquidity: 0.112019751, decimals: 9 });
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toContain("wSOL");
  });

  it("treats empty / zero / NaN amounts as ok (other guards catch those)", () => {
    expect(checkBorrowLiquidity({ amountHuman: "", symbol: "wUSDC", availableLiquidity: 3.84, decimals: 6 }).ok).toBe(true);
    expect(checkBorrowLiquidity({ amountHuman: "0", symbol: "wUSDC", availableLiquidity: 3.84, decimals: 6 }).ok).toBe(true);
    expect(checkBorrowLiquidity({ amountHuman: "abc", symbol: "wUSDC", availableLiquidity: 3.84, decimals: 6 }).ok).toBe(true);
    expect(checkBorrowLiquidity({ amountHuman: "-1", symbol: "wUSDC", availableLiquidity: 3.84, decimals: 6 }).ok).toBe(true);
  });

  it("when pool has zero supply, blocks any positive borrow", () => {
    const r = checkBorrowLiquidity({ amountHuman: "0.001", symbol: "wSOL", availableLiquidity: 0, decimals: 9 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("0");
    expect(r.message).toContain("wSOL");
  });

  it("rounds the human-readable available to at most 6 decimal places (UX cap)", () => {
    const r = checkBorrowLiquidity({ amountHuman: "1", symbol: "wSOL", availableLiquidity: 0.123456789012345, decimals: 9 });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("0.123457");
    expect(r.message).not.toContain("0.123456789");
  });

  it("trims trailing zeros from formatted available (3.500 → 3.5, not '3.500000')", () => {
    const r = checkBorrowLiquidity({ amountHuman: "10", symbol: "wUSDC", availableLiquidity: 3.5, decimals: 6 });
    expect(r.message).toContain("3.5");
    expect(r.message).not.toContain("3.500000");
  });
});

describe("checkActionSafety", () => {
  // ── withdraw — the two live bugs the user hit ──
  it("withdraw: blocks when amount exceeds available pool liquidity (the live USDC underflow)", () => {
    const r = checkActionSafety({
      mode: "withdraw", amountHuman: "1", symbol: "USDC", decimals: 6,
      suppliedBalance: 2, availableLiquidity: 0.020004,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/liquid right now|borrowed out/i);
  });

  it("withdraw: blocks when it would drop HF below 1 (the live SALT 0x6679996d)", () => {
    const r = checkActionSafety({
      mode: "withdraw", amountHuman: "1", symbol: "SALT", decimals: 18,
      suppliedBalance: 1, availableLiquidity: 100, projectedHfAfter: 0.8,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/health factor.*0\.80.*below 1|repay/i);
  });

  it("withdraw: blocks withdrawing more than supplied", () => {
    const r = checkActionSafety({
      mode: "withdraw", amountHuman: "50", symbol: "SALT", decimals: 18,
      suppliedBalance: 1, availableLiquidity: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/only supplied/i);
  });

  it("withdraw: permits a safe partial withdraw (liquid + HF stays above 1)", () => {
    const r = checkActionSafety({
      mode: "withdraw", amountHuman: "0.01", symbol: "USDC", decimals: 6,
      suppliedBalance: 2, availableLiquidity: 0.02, projectedHfAfter: 5,
    });
    expect(r.ok).toBe(true);
  });

  // ── supply ──
  it("supply: blocks above wallet balance", () => {
    const r = checkActionSafety({ mode: "supply", amountHuman: "100", symbol: "USDC", decimals: 6, walletBalance: 10 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/wallet/i);
  });
  it("supply: blocks a frozen reserve", () => {
    const r = checkActionSafety({ mode: "supply", amountHuman: "1", symbol: "USDC", decimals: 6, walletBalance: 100, frozen: true });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/frozen/i);
  });
  it("supply: blocks when supply cap would be exceeded", () => {
    const r = checkActionSafety({ mode: "supply", amountHuman: "50", symbol: "USDC", decimals: 6, walletBalance: 100, totalSupply: 80, supplyCap: 100 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/supply cap/i);
  });
  it("supply: cap=0 means uncapped", () => {
    const r = checkActionSafety({ mode: "supply", amountHuman: "999", symbol: "USDC", decimals: 6, walletBalance: 1000, totalSupply: 80, supplyCap: 0 });
    expect(r.ok).toBe(true);
  });

  // ── borrow ──
  it("borrow: blocks beyond borrowing power", () => {
    const r = checkActionSafety({
      mode: "borrow", amountHuman: "10", symbol: "USDC", decimals: 6,
      priceUsd: 1, availableLiquidity: 1000, availableBorrowsUsd: 5,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/borrowing power/i);
  });
  it("borrow: blocks a non-borrowable reserve", () => {
    const r = checkActionSafety({ mode: "borrow", amountHuman: "1", symbol: "USDC", decimals: 6, availableLiquidity: 100, canBeBorrowed: false });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/can't be borrowed/i);
  });

  // ── repay ──
  it("repay: blocks when there's no debt", () => {
    const r = checkActionSafety({ mode: "repay", amountHuman: "1", symbol: "USDC", decimals: 6, debtBalance: 0, walletBalance: 100 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no USDC debt/i);
  });
  it("repay: blocks above wallet balance", () => {
    const r = checkActionSafety({ mode: "repay", amountHuman: "5", symbol: "USDC", decimals: 6, debtBalance: 10, walletBalance: 2 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/wallet/i);
  });
  it("repay: permits a valid repay", () => {
    const r = checkActionSafety({ mode: "repay", amountHuman: "1", symbol: "USDC", decimals: 6, debtBalance: 2, walletBalance: 5 });
    expect(r.ok).toBe(true);
  });

  it("treats empty/zero amounts as ok (submit-disabled handles them)", () => {
    expect(checkActionSafety({ mode: "withdraw", amountHuman: "", symbol: "USDC", decimals: 6, suppliedBalance: 0 }).ok).toBe(true);
    expect(checkActionSafety({ mode: "supply", amountHuman: "0", symbol: "USDC", decimals: 6, walletBalance: 0 }).ok).toBe(true);
  });
});
