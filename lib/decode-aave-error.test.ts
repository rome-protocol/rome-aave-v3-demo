import { describe, expect, it } from "vitest";

import { decodeAaveError } from "./decode-aave-error";

describe("decodeAaveError", () => {
  it("decodes HealthFactorLowerThanLiquidationThreshold from a selector in the message (the live SALT case)", () => {
    const err = {
      shortMessage:
        'The contract function "withdraw" reverted with the following signature: 0x6679996d',
    };
    expect(decodeAaveError(err)).toMatch(/health factor below 1/i);
    expect(decodeAaveError(err)).toMatch(/repay/i);
  });

  it("decodes arithmetic underflow text into a liquidity message (the live USDC case)", () => {
    const err = {
      shortMessage:
        'The contract function "withdraw" reverted with the following reason: Arithmetic operation resulted in underflow or overflow.',
    };
    expect(decodeAaveError(err)).toMatch(/exceeds what's available|liquidity/i);
  });

  it("decodes a selector hiding in structured revert data", () => {
    const err = { cause: { data: "0xf58f733a" } }; // SupplyCapExceeded
    expect(decodeAaveError(err)).toMatch(/supply cap/i);
  });

  it("decodes Panic(0x11) from structured data", () => {
    // Panic(uint256) selector + 0x11 code word
    const err = {
      cause: {
        data:
          "0x4e487b71" +
          "0000000000000000000000000000000000000000000000000000000000000011",
      },
    };
    expect(decodeAaveError(err)).toMatch(/exceeds what's available/i);
  });

  it("decodes InvalidAmount (0x2c5211c6)", () => {
    expect(decodeAaveError({ message: "execution reverted: 0x2c5211c6" })).toMatch(
      /greater than zero/i,
    );
  });

  it("recognizes user rejection", () => {
    expect(
      decodeAaveError({ shortMessage: "User rejected the request." }),
    ).toMatch(/rejected the transaction/i);
  });

  it("decodes CollateralCannotCoverNewBorrow (0x911ceb81)", () => {
    expect(decodeAaveError({ cause: { data: "0x911ceb81" } })).toMatch(
      /collateral can't cover|supply more collateral/i,
    );
  });

  it("decodes HealthFactorNotBelowThreshold for liquidation of a healthy position", () => {
    expect(decodeAaveError({ cause: { data: "0x930bb771" } })).toMatch(
      /healthy|can't be liquidated/i,
    );
  });

  it("falls back to shortMessage for unknown selectors", () => {
    const err = { shortMessage: "Some novel error", message: "long detail" };
    expect(decodeAaveError(err)).toBe("Some novel error");
  });

  it("truncates very long fallback messages", () => {
    const long = "x".repeat(500);
    const out = decodeAaveError({ message: long });
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never throws on null/odd input", () => {
    expect(() => decodeAaveError(null)).not.toThrow();
    expect(() => decodeAaveError(undefined)).not.toThrow();
    expect(() => decodeAaveError(42)).not.toThrow();
    expect(decodeAaveError(null)).toBeTruthy();
  });
});
