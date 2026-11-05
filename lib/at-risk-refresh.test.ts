import { describe, expect, it, vi } from "vitest";
import { blockWindows, chunk, refreshRowsBatched, type Read } from "./at-risk-refresh";

type Health = { hf: number; debt: number };
type Row = { borrower: string; hf: number };
const row = (b: string, hf = 0.9): Row => ({ borrower: b, hf });
const ok = <T,>(value: T): Read<T> => ({ ok: true, value });
const bad: Read<never> = { ok: false };

const run = (o: {
  borrowers: string[];
  health: (b: string) => Read<Health>;
  positions?: (b: string) => Read<string>;
  lastGood?: Map<string, Row>;
  readHealth?: (batch: string[]) => Promise<Array<Read<Health>>>;
}) => {
  const lastGood = o.lastGood ?? new Map<string, Row>();
  const calls = { health: [] as string[][], positions: [] as string[][] };
  const p = refreshRowsBatched<Health, string, Row>({
    borrowers: o.borrowers,
    batchSize: 2,
    retryDelayMs: 0,
    readHealth: o.readHealth ?? (async (batch) => (calls.health.push(batch), batch.map(o.health))),
    readPositions: async (batch) => (calls.positions.push(batch), batch.map(o.positions ?? (() => ok("pos")))),
    inBand: (h) => h.debt > 0 && h.hf <= 2,
    toRow: (b, h) => row(b, h.hf),
    lastGood,
  });
  return { p, calls, lastGood };
};

describe("refreshRowsBatched", () => {
  it("reads health in batches, and positions only for borrowers inside the band", async () => {
    const health: Record<string, Health> = { a: { hf: 0.9, debt: 5 }, b: { hf: 3, debt: 5 }, c: { hf: 1.5, debt: 0 }, d: { hf: 1.2, debt: 7 }, e: { hf: 1.9, debt: 1 } };
    const { p, calls } = run({ borrowers: Object.keys(health), health: (b) => ok(health[b]) });
    const { rows, failed } = await p;
    expect(calls.health).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(calls.positions).toEqual([["a", "d"], ["e"]]);
    expect(rows.map((r) => r.borrower)).toEqual(["a", "d", "e"]);
    expect(failed).toBe(0);
  });

  it("keeps the last good row when one sub-call fails, and still updates the rest", async () => {
    const lastGood = new Map([["a", row("a", 0.97)]]);
    const { p } = run({ borrowers: ["a", "b"], health: (b) => (b === "a" ? bad : ok({ hf: 0.8, debt: 1 })), lastGood });
    const { rows, failed } = await p;
    expect(failed).toBe(1);
    expect(rows.find((r) => r.borrower === "a")?.hf).toBe(0.97);
    expect(rows.find((r) => r.borrower === "b")?.hf).toBe(0.8);
  });

  it("keeps the last good row when a positions read fails", async () => {
    const lastGood = new Map([["a", row("a", 0.97)]]);
    const { p } = run({ borrowers: ["a"], health: () => ok({ hf: 0.8, debt: 1 }), positions: () => bad, lastGood });
    const { rows, failed } = await p;
    expect(failed).toBe(1);
    expect(rows).toEqual([row("a", 0.97)]);
  });

  it("retries a failed batch, then keeps every last good row in it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let tries = 0;
    const lastGood = new Map([["a", row("a", 0.97)]]);
    const { p } = run({
      borrowers: ["a", "b"],
      health: () => bad,
      readHealth: async () => {
        tries++;
        throw new Error("upstream request failed");
      },
      lastGood,
    });
    const { rows, failed } = await p;
    expect(tries).toBe(9); // 3 tries at size 2, then 3 for each half
    expect(failed).toBe(2);
    expect(rows).toEqual([row("a", 0.97)]);
  });

  it("splits a batch that keeps failing, so a size limit does not hide new borrowers", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { p } = run({
      borrowers: ["a", "b", "c"],
      health: () => bad,
      readHealth: async (batch) => {
        if (batch.length > 1) throw new Error("too large");
        return [ok({ hf: 0.8, debt: 1 })];
      },
    });
    const { rows, failed } = await p;
    expect(failed).toBe(0);
    expect(rows.map((r) => r.borrower)).toEqual(["a", "b", "c"]);
  });

  it("recovers on a retry", async () => {
    let tries = 0;
    const { p } = run({
      borrowers: ["a"],
      health: () => bad,
      readHealth: async (batch) => (++tries < 2 ? Promise.reject(new Error("blip")) : batch.map(() => ok({ hf: 0.8, debt: 1 }))),
    });
    const { rows, failed } = await p;
    expect(failed).toBe(0);
    expect(rows).toEqual([row("a", 0.8)]);
  });

  it("drops and forgets a repaid borrower", async () => {
    const lastGood = new Map([["a", row("a")]]);
    const { p } = run({ borrowers: ["a"], health: () => ok({ hf: Infinity, debt: 0 }), lastGood });
    expect((await p).rows).toEqual([]);
    expect(lastGood.size).toBe(0);
  });
});

describe("chunk", () => {
  it("splits into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe("blockWindows", () => {
  it("cuts inclusive windows of at most 1,000,000 blocks", () => {
    const w = blockWindows(500_576_604n, 502_700_000n, 1_000_000n);
    expect(w[0]).toEqual([500_576_604n, 501_576_603n]);
    expect(w[w.length - 1][1]).toBe(502_700_000n);
    for (const [s, e] of w) expect(e - s + 1n).toBeLessThanOrEqual(1_000_000n);
    expect(w.length).toBe(3);
  });

  it("returns nothing when there is nothing to scan", () => {
    expect(blockWindows(10n, 9n, 1_000_000n)).toEqual([]);
  });
});
