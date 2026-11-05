import { describe, expect, it } from "vitest";
import { fmt, fmtAmount, fmtPrice, fmtShare, fmtUsd } from "./format";

describe("fmt.amount", () => {
  it("shows small amounts with decimals, not 0", () => {
    expect(fmt.amount(0.01566)).toBe("0.0157");
    expect(fmt.amount(0.2467)).toBe("0.2467");
    expect(fmt.amount(0.00004)).toBe("<0.0001");
  });
  it("trims decimals on larger amounts", () => {
    expect(fmt.amount(1234.5678)).toBe("1,234.57");
    expect(fmt.amount(5)).toBe("5");
    expect(fmt.amount(0)).toBe("0");
    expect(fmt.amount(null)).toBe("—");
  });
});

describe("fmt.pct", () => {
  it("never rounds a positive rate to 0.00%", () => {
    expect(fmt.pct(1e-6)).toBe("<0.01%");
    expect(fmt.pct(0)).toBe("0.00%");
    expect(fmt.pct(0.0425)).toBe("4.25%");
  });
});

describe("fmt.cap", () => {
  it("says No cap for a zero cap", () => {
    expect(fmt.cap(0, 2000)).toBe("No cap");
    expect(fmt.cap(1000, 2)).toBe("$2.0K");
  });
});

describe("fmtUsd", () => {
  it("two decimals under $1,000, one decimal with K, two with M", () => {
    expect(fmtUsd(524.81)).toBe("$524.81");
    expect(fmtUsd(999.99)).toBe("$999.99");
    expect(fmtUsd(1742)).toBe("$1.7K");
    expect(fmtUsd(17_432)).toBe("$17.4K");
    expect(fmtUsd(2_410_000)).toBe("$2.41M");
    expect(fmtUsd(999_990)).toBe("$1.00M");
  });
  it("zero, dust, negatives and non-numbers", () => {
    expect(fmtUsd(0)).toBe("$0.00");
    expect(fmtUsd(0.004)).toBe("<$0.01");
    expect(fmtUsd(-1742)).toBe("-$1.7K");
    expect(fmtUsd(NaN)).toBe("—");
    expect(fmtUsd(null)).toBe("—");
    expect(fmtUsd(undefined)).toBe("—");
  });
});

describe("fmtAmount", () => {
  it("2 decimals from 1,000, 4 from 1, 6 below 1, trailing zeros dropped", () => {
    expect(fmtAmount(26.29)).toBe("26.29");
    expect(fmtAmount(1234.5678)).toBe("1,234.57");
    expect(fmtAmount(1.23456)).toBe("1.2346");
    expect(fmtAmount(0.003192)).toBe("0.003192");
    expect(fmtAmount(5)).toBe("5");
    expect(fmtAmount(0)).toBe("0");
  });
  it("M from a million", () => {
    expect(fmtAmount(1_250_000)).toBe("1.25M");
  });
  it("dust never reads as 0", () => {
    expect(fmtAmount(0.0000004)).toBe("<0.000001");
    expect(fmtAmount(0.00004)).toBe("0.00004");
    expect(fmtAmount(NaN)).toBe("—");
  });
});

describe("fmtShare", () => {
  it("two decimals, and a tiny share is never 0.00%", () => {
    expect(fmtShare(12.3456)).toBe("12.35%");
    expect(fmtShare(0.0001)).toBe("<0.01%");
    expect(fmtShare(0.01)).toBe("0.01%");
    expect(fmtShare(0)).toBe("0%");
    expect(fmtShare(NaN)).toBe("0%");
  });
});

describe("fmtPrice", () => {
  it("keeps a stablecoin's decimals and never compacts to K", () => {
    expect(fmtPrice(0.9999)).toBe("$0.9999");
    expect(fmtPrice(1)).toBe("$1.00");
    expect(fmtPrice(95.17)).toBe("$95.17");
    expect(fmtPrice(95.3589)).toBe("$95.36");
    expect(fmtPrice(2391.29)).toBe("$2,391.29");
    expect(fmtPrice(NaN)).toBe("—");
  });
});
