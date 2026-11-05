import { describe, it, expect } from "vitest";
import { classifySignature, foldHolders, splitReserves, buildOverview, sumSides, splitIsFresh, type ReserveInput, type Position } from "./market-split";

const RAY = 10n ** 27n;
const reserve = (over: Partial<ReserveInput> = {}): ReserveInput => ({
  asset: "0xAAA", symbol: "USDC", decimals: 6, priceUsd: 1,
  liquidityIndex: RAY, variableBorrowIndex: RAY,
  totalSupplyRaw: 1_000_000n, totalDebtRaw: 300_000n, ...over,
});
const pos = (side: Position["side"], scaledA: bigint, scaledDebt: bigint, asset = "0xaaa"): Position => ({ side, reserves: [{ asset, scaledA, scaledDebt }] });

describe("classifySignature", () => {
  it("zero r and s is a Solana wallet", () => {
    expect(classifySignature({ r: "0x0", s: "0x0" })).toBe("solana");
    expect(classifySignature({ r: "0x" + "0".repeat(64), s: "0x" + "0".repeat(64) })).toBe("solana");
  });
  it("a real signature is an EVM wallet", () => {
    expect(classifySignature({ r: "0x" + "ab".repeat(32), s: "0x" + "cd".repeat(32) })).toBe("evm");
  });
  it("a missing r or s is not evidence: unclassified", () => {
    expect(classifySignature({})).toBeUndefined();
    expect(classifySignature({ r: "0x0" })).toBeUndefined();
    expect(classifySignature({ r: null, s: "0x0" })).toBeUndefined();
  });
});

describe("foldHolders", () => {
  const log = (user: string, onBehalfOf: string, transactionHash: string) => ({ args: { user, onBehalfOf }, transactionHash });
  it("keeps the first tx a holder sent itself; a supply on behalf of someone else is not its own", () => {
    const h = new Map<string, string | undefined>();
    foldHolders([log("0xAA", "0xAA", "0x1"), log("0xBB", "0xCC", "0x2"), log("0xDD", "0xBB", "0x3")], h);
    expect(h.get("0xaa")).toBe("0x1");
    expect(h.get("0xcc")).toBeUndefined();
    expect(h.has("0xcc")).toBe(true);
    expect(h.get("0xbb")).toBeUndefined();
    foldHolders([log("0xCC", "0xCC", "0x4"), log("0xAA", "0xAA", "0x5"), log("0xBB", "0xBB", "0x6")], h);
    expect(h.get("0xcc")).toBe("0x4"); // a later own tx fills the gap
    expect(h.get("0xaa")).toBe("0x1"); // the first own tx wins
    expect(h.get("0xbb")).toBe("0x6");
  });
});

describe("splitReserves", () => {
  it("sums each side, matches assets case-insensitively and applies the indices", () => {
    const r = reserve({ liquidityIndex: (RAY * 11n) / 10n, variableBorrowIndex: (RAY * 12n) / 10n, totalSupplyRaw: 10_000_000n, totalDebtRaw: 10_000_000n });
    const [s] = splitReserves([r], [pos("evm", 1_000_000n, 500_000n), pos("evm", 1_000_000n, 0n), pos("solana", 2_000_000n, 1_000_000n), pos("evm", 5n, 5n, "0xother")]);
    expect(s.supplied.evm).toBe(2_200_000n);
    expect(s.supplied.solana).toBe(2_200_000n);
    expect(s.borrowed.evm).toBe(600_000n);
    expect(s.borrowed.solana).toBe(1_200_000n);
  });
});

describe("sides add up to the market totals", () => {
  it("other is the remainder, including addresses with no known side", () => {
    const r = reserve();
    const positions = [pos("evm", 400_000n, 100_000n), pos("solana", 500_000n, 150_000n), pos("other", 50_000n, 0n)];
    const [s] = splitReserves([r], positions);
    expect(s.supplied.other).toBe(100_000n);
    expect(s.borrowed.other).toBe(50_000n);
    expect(s.supplied.evm + s.supplied.solana + s.supplied.other).toBe(r.totalSupplyRaw);
    expect(s.borrowed.evm + s.borrowed.solana + s.borrowed.other).toBe(r.totalDebtRaw);
  });

  it("never reports a negative remainder when rounding overshoots the total", () => {
    const [s] = splitReserves([reserve({ totalSupplyRaw: 999_999n })], [pos("evm", 500_000n, 0n), pos("solana", 500_000n, 0n)]);
    expect(s.supplied.other).toBe(0n);
  });

  it("headline USD equals the per-asset totals at the oracle price", () => {
    const rs = [reserve(), reserve({ asset: "0xBBB", symbol: "ETH", decimals: 18, priceUsd: 2000, totalSupplyRaw: 5n * 10n ** 18n, totalDebtRaw: 10n ** 18n })];
    const positions: Position[] = [
      { side: "evm", reserves: [{ asset: "0xaaa", scaledA: 600_000n, scaledDebt: 200_000n }, { asset: "0xbbb", scaledA: 2n * 10n ** 18n, scaledDebt: 0n }] },
      { side: "solana", reserves: [{ asset: "0xaaa", scaledA: 300_000n, scaledDebt: 100_000n }, { asset: "0xbbb", scaledA: 2n * 10n ** 18n, scaledDebt: 10n ** 18n }] },
    ];
    const o = buildOverview(rs, positions, { scannedBlock: 7n });
    expect(sumSides(o.headline.sizeUsd)).toBeCloseTo(1 + 5 * 2000, 6);
    expect(sumSides(o.headline.borrowsUsd)).toBeCloseTo(0.3 + 2000, 6);
    expect(sumSides(o.headline.availableUsd)).toBeCloseTo(sumSides(o.headline.sizeUsd) - sumSides(o.headline.borrowsUsd), 6);
    expect(o.headline.availableUsd.evm).toBeCloseTo(4000.4, 6);
    expect(o.headline.availableUsd.solana).toBeCloseTo(2000.2, 6);
    expect(o.headline.availableUsd.other).toBeCloseTo(2000.1, 6);
    expect(o.addresses).toEqual({ evm: 1, solana: 1, other: 0 });
    expect(o.reserves[1].supplied.solana).toBe(2);
    expect(o.reserves[0].utilization).toBeCloseTo(0.3, 6);
    expect(o.scannedBlock).toBe("7");
  });
});

describe("splitIsFresh", () => {
  it("serves the split for 2 minutes after the last fully good balance read, never before one", () => {
    expect(splitIsFresh(0, 1_000_000)).toBe(false);
    expect(splitIsFresh(1_000_000, 1_000_000 + 119_000)).toBe(true);
    expect(splitIsFresh(1_000_000, 1_000_000 + 121_000)).toBe(false);
  });
});
