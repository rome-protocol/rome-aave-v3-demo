import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWarmFeed } from "./warm-feed";
import { loadAtRiskFeed } from "./at-risk-indexer";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createWarmFeed", () => {
  it("builds once for concurrent first reads, then answers from memory without waiting", async () => {
    let builds = 0;
    const feed = createWarmFeed(async () => ++builds, 15_000);
    const [a, b] = await Promise.all([feed.get(), feed.get()]);
    expect(builds).toBe(1);
    expect(a.value).toBe(1);
    expect(b.generatedAt).toBe(a.generatedAt);
    expect((await feed.get()).value).toBe(1);
    expect(builds).toBe(1);
  });

  it("keeps serving the old list while a rebuild is slow, and swaps it in when done", async () => {
    let release!: () => void;
    let builds = 0;
    const feed = createWarmFeed(async () => {
      const n = ++builds;
      if (n === 2) await new Promise<void>((r) => (release = r));
      return n;
    }, 15_000);
    await feed.get();
    await vi.advanceTimersByTimeAsync(15_000); // rebuild 2 starts and hangs
    await vi.advanceTimersByTimeAsync(15_000); // a second tick must not start a third build
    expect(builds).toBe(2);
    expect((await feed.get()).value).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect((await feed.get()).value).toBe(2);
  });

  it("keeps the last list when a background rebuild fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let builds = 0;
    const feed = createWarmFeed(async () => {
      if (++builds === 2) throw new Error("rpc down");
      return builds;
    }, 15_000);
    await feed.get();
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await feed.get()).value).toBe(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await feed.get()).value).toBe(3);
  });

  it("update patches the held value", async () => {
    const feed = createWarmFeed(async () => ({ rows: [1] }), 15_000);
    await feed.get();
    feed.update((v) => ({ rows: [...v.rows, 2] }));
    expect((await feed.get()).value.rows).toEqual([1, 2]);
  });

  it("keeps a patch made while a rebuild was already running", async () => {
    let release!: () => void;
    let builds = 0;
    const feed = createWarmFeed(async () => {
      const n = ++builds;
      if (n === 2) await new Promise<void>((r) => (release = r));
      return [`old${n}`];
    }, 15_000);
    await feed.get();
    await vi.advanceTimersByTimeAsync(15_000); // rebuild 2 starts and hangs
    feed.update((v) => [...v.filter((x) => x !== "gone"), "patched"]);
    expect((await feed.get()).value).toEqual(["old1", "patched"]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect((await feed.get()).value).toEqual(["old2", "patched"]);
  });

  it("starts no timer until the first build has worked", async () => {
    let fail = true;
    const feed = createWarmFeed(async () => { if (fail) throw new Error("rpc down"); return 1; }, 15_000);
    await expect(feed.get()).rejects.toThrow("rpc down");
    expect(vi.getTimerCount()).toBe(0);
    fail = false;
    await feed.get();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("an unknown chainId creates no feed and no timer", async () => {
    for (const id of [7, 1.5, 16]) await expect(loadAtRiskFeed(id)).rejects.toThrow("Unsupported chainId");
    expect(vi.getTimerCount()).toBe(0);
  });
});
