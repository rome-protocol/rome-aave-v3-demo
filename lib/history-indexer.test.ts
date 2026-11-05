import { describe, it, expect } from "vitest";
import { splitWindows, extendScan, MAX_LOG_WINDOW, type CachedLog, type ScanState } from "./history-indexer";

const log = (n: bigint): CachedLog => ({ eventName: "Supply", args: {}, blockNumber: n, transactionHash: "0x" + n.toString(16) });

describe("splitWindows", () => {
  it("uses inclusive bounds and never exceeds the window size", () => {
    const w = splitWindows(0n, 2_999_999n, 1_000_000n);
    expect(w).toEqual([[0n, 999_999n], [1_000_000n, 1_999_999n], [2_000_000n, 2_999_999n]]);
    for (const [a, b] of w) expect(b - a + 1n).toBeLessThanOrEqual(MAX_LOG_WINDOW);
  });
  it("ends on a last partial window at exactly `to`", () => {
    expect(splitWindows(10n, 25n, 10n)).toEqual([[10n, 19n], [20n, 25n]]);
  });
  it("returns one single-block window, and none for an empty range", () => {
    expect(splitWindows(5n, 5n, 10n)).toEqual([[5n, 5n]]);
    expect(splitWindows(6n, 5n, 10n)).toEqual([]);
  });
});

describe("extendScan", () => {
  const fresh = (): ScanState => ({ logs: [], lastScannedBlock: 99n });

  it("scans the whole range once, then only the new blocks", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const fetchWindow = async (a: bigint, b: bigint) => { calls.push([a, b]); return [log(a)]; };
    const s = fresh();
    await extendScan(s, 124n, fetchWindow);
    expect(calls).toEqual([[100n, 124n]]);
    await extendScan(s, 124n, fetchWindow); // nothing new
    expect(calls.length).toBe(1);
    await extendScan(s, 130n, fetchWindow);
    expect(calls[1]).toEqual([125n, 130n]);
    expect(s.lastScannedBlock).toBe(130n);
    expect(s.logs.map((l) => l.blockNumber)).toEqual([100n, 125n]);
  });

  it("shares one in-flight scan between concurrent callers", async () => {
    let calls = 0;
    const fetchWindow = async (a: bigint) => { calls++; await new Promise((r) => setTimeout(r, 10)); return [log(a)]; };
    const s = fresh();
    await Promise.all([extendScan(s, 200n, fetchWindow), extendScan(s, 200n, fetchWindow), extendScan(s, 200n, fetchWindow)]);
    expect(calls).toBe(1);
    expect(s.logs.length).toBe(1);
  });

  it("keeps finished windows when a later window fails, and resumes from there", async () => {
    const s = fresh();
    const head = 99n + MAX_LOG_WINDOW * 2n;
    let fail = true;
    const fetchWindow = async (a: bigint) => {
      if (a > 100n && fail) throw new Error("boom");
      return [log(a)];
    };
    await expect(extendScan(s, head, fetchWindow)).rejects.toThrow("boom");
    expect(s.lastScannedBlock).toBe(99n + MAX_LOG_WINDOW);
    expect(s.inflight).toBeUndefined();
    fail = false;
    await extendScan(s, head, fetchWindow);
    expect(s.lastScannedBlock).toBe(head);
    expect(s.logs.length).toBe(2);
  });
});
