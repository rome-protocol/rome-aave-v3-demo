import { beforeEach, describe, expect, it, vi } from "vitest";

import { _memoTtlReset, memoTtl } from "./memo";

beforeEach(() => {
  _memoTtlReset();
  vi.useRealTimers();
});

describe("memoTtl — fresh path", () => {
  it("returns the resolved value on first call", async () => {
    const loader = vi.fn().mockResolvedValue("fresh");
    await expect(memoTtl("k", 1000, loader)).resolves.toBe("fresh");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight callers (one upstream call)", async () => {
    let resolve!: (v: string) => void;
    const loader = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const [a, b, c] = [memoTtl("k", 1000, loader), memoTtl("k", 1000, loader), memoTtl("k", 1000, loader)];
    expect(loader).toHaveBeenCalledTimes(1);
    resolve("done");
    await Promise.all([a, b, c]).then((vals) => expect(vals).toEqual(["done", "done", "done"]));
  });

  it("evicts on rejection so the next caller retries", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("recovered");
    await expect(memoTtl("k", 1000, loader)).rejects.toThrow("boom");
    await expect(memoTtl("k", 1000, loader)).resolves.toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe("memoTtl — stale-while-revalidate", () => {
  it("returns last value instantly when stale + within staleTtl, and kicks off background refresh", async () => {
    vi.useFakeTimers();
    const loader = vi.fn()
      .mockResolvedValueOnce("v1")
      .mockResolvedValueOnce("v2");
    // First call: cold, ttlMs=1000, staleTtl=10_000
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v1");
    expect(loader).toHaveBeenCalledTimes(1);

    // Advance past ttl but inside staleTtl: should serve "v1" instantly
    vi.advanceTimersByTime(2000);
    const stalePromise = memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });
    // The returned promise should ALREADY be resolved — i.e., the consumer
    // doesn't wait on the upstream call. Drain the microtask queue to verify.
    await vi.advanceTimersByTimeAsync(0);
    await expect(stalePromise).resolves.toBe("v1");
    // Background refresh was kicked off — should be the second invocation.
    expect(loader).toHaveBeenCalledTimes(2);

    // Let the background refresh resolve, then subsequent hit returns "v2".
    await vi.advanceTimersByTimeAsync(0);
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v2");
    expect(loader).toHaveBeenCalledTimes(2); // No third call — back to fresh.
  });

  it("doesn't fire concurrent background refreshes (one refresh in flight at a time)", async () => {
    vi.useFakeTimers();
    let resolve!: (v: string) => void;
    const loader = vi.fn(() => {
      if (loader.mock.calls.length === 1) return Promise.resolve("v1");
      return new Promise<string>((r) => (resolve = r));
    });
    await memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });

    vi.advanceTimersByTime(2000);
    // Five stale hits in quick succession — should fire only ONE background refresh.
    const hits = await Promise.all(
      [0, 0, 0, 0, 0].map(() => memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })),
    );
    expect(hits).toEqual(["v1", "v1", "v1", "v1", "v1"]);
    expect(loader).toHaveBeenCalledTimes(2); // one initial + one background, NOT six.

    resolve!("v2");
    await vi.advanceTimersByTimeAsync(0);
  });

  it("falls back to full upstream call when stale past staleTtl", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    await memoTtl("k", 1000, loader, { staleTtlMs: 5000 });

    // Advance well past ttl + staleTtl (1000 + 5000 = 6000ms total grace).
    vi.advanceTimersByTime(10_000);
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 5000 })).resolves.toBe("v2");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps serving stale value when background refresh fails", async () => {
    vi.useFakeTimers();
    // Silence the expected error log from the background refresh failure.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = vi.fn()
      .mockResolvedValueOnce("v1")
      .mockRejectedValueOnce(new Error("upstream-down"))
      .mockResolvedValueOnce("v3");
    await memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });

    vi.advanceTimersByTime(2000);
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v1");
    expect(loader).toHaveBeenCalledTimes(2);

    // Background refresh has now failed. Next stale hit should retry the refresh
    // (since the `refreshing` flag was cleared on error).
    await vi.advanceTimersByTimeAsync(0); // let the rejected refresh settle
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v1");
    expect(loader).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(0); // let the third (successful) refresh settle
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v3");

    errSpy.mockRestore();
  });

  it("staleTtlMs=0 (or absent) preserves the original fresh-only behavior", async () => {
    vi.useFakeTimers();
    const loader = vi.fn().mockResolvedValueOnce("v1").mockResolvedValueOnce("v2");
    await memoTtl("k", 1000, loader); // no options
    vi.advanceTimersByTime(2000);
    // Without staleTtlMs, the second call should be a fresh upstream call —
    // the consumer awaits the loader, not the old value.
    await expect(memoTtl("k", 1000, loader)).resolves.toBe("v2");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("evicts the stale entry after 3 consecutive refresh failures — circuit-breaker", async () => {
    vi.useFakeTimers();
    // Silence the error logs from the 3 failed refreshes + the eviction notice.
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // 1 success + 3 consecutive failed refreshes → entry evicted. The 4th
    // call cold-loads and surfaces the upstream error (no more serving
    // arbitrarily-stale data while upstream is down).
    const loader = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockRejectedValueOnce(new Error("fail-1"))
      .mockRejectedValueOnce(new Error("fail-2"))
      .mockRejectedValueOnce(new Error("fail-3"))
      .mockRejectedValueOnce(new Error("cold-after-evict"));
    await memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });

    // Three stale hits, each kicks off a refresh that fails. Stale value
    // ("v1") keeps being served — counter still under threshold.
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(2000);
      await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).resolves.toBe("v1");
      await vi.advanceTimersByTimeAsync(0); // let the rejected refresh settle
    }

    // Fourth call: the third failure tripped the breaker → entry evicted →
    // this is now a cold load that propagates the upstream error.
    await expect(memoTtl("k", 1000, loader, { staleTtlMs: 10_000 })).rejects.toThrow(
      "cold-after-evict",
    );
    expect(loader).toHaveBeenCalledTimes(5); // 1 initial + 3 failed refreshes + 1 cold

    errSpy.mockRestore();
  });

  it("resets the fail counter on a successful refresh — single failures don't trip the breaker over time", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // fail, succeed, fail, succeed, fail — never 3 in a row → no eviction.
    const loader = vi
      .fn()
      .mockResolvedValueOnce("v1")
      .mockRejectedValueOnce(new Error("transient-1"))
      .mockResolvedValueOnce("v2")
      .mockRejectedValueOnce(new Error("transient-2"))
      .mockResolvedValueOnce("v3");
    await memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });

    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2000);
      // Either the prior stale value or a refreshed value — never throws.
      await memoTtl("k", 1000, loader, { staleTtlMs: 10_000 });
      await vi.advanceTimersByTimeAsync(0);
    }
    // 4 iterations of alternating fail/success; counter never reached 3 in a
    // row → entry survived → all 4 refresh attempts ran (1 initial + 4 = 5).
    // If the entry had been evicted, the next iteration would have cold-loaded
    // off an exhausted mock and crashed.
    expect(loader).toHaveBeenCalledTimes(5);
    errSpy.mockRestore();
  });
});
