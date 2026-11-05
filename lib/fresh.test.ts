import { beforeEach, describe, expect, it, vi } from "vitest";

import { FRESH_WINDOW_MS, cacheControlFor, freshParam, markFresh, wantsFresh } from "./fresh";
import { _memoTtlReset, memoRefresh, memoTtl } from "./memo";

beforeEach(() => _memoTtlReset());

describe("fresh flag", () => {
  it("adds the query flag only inside the window after an action", () => {
    expect(freshParam(0)).toBe("");
    markFresh(1_000);
    expect(freshParam(1_000 + FRESH_WINDOW_MS - 1)).toBe("&fresh=1");
    expect(freshParam(1_000 + FRESH_WINDOW_MS)).toBe("");
  });

  it("server reads the flag and drops the public cache header", () => {
    expect(wantsFresh(new URLSearchParams("fresh=1"))).toBe(true);
    expect(wantsFresh(new URLSearchParams("user=0x1"))).toBe(false);
    expect(cacheControlFor(true, "public, max-age=5")).toBe("no-store");
    expect(cacheControlFor(false, "public, max-age=5")).toBe("public, max-age=5");
  });
});

describe("memoRefresh", () => {
  const later = (v: string, ms: number) => () => new Promise<string>((r) => setTimeout(() => r(v), ms));

  it("normal callers get the last value at once while a refresh runs", async () => {
    await memoTtl("k", 1, later("old", 0), { staleTtlMs: 60_000 });
    await new Promise((r) => setTimeout(r, 5));
    const fresh = memoRefresh("k", 60_000, later("new", 200));
    const t0 = Date.now();
    await expect(memoTtl("k", 1, later("x", 200), { staleTtlMs: 60_000 })).resolves.toBe("old");
    expect(Date.now() - t0).toBeLessThan(100);
    await expect(fresh).resolves.toBe("new");
    await expect(memoTtl("k", 60_000, later("x", 0))).resolves.toBe("new");
  });

  it("concurrent fresh calls share one loader", async () => {
    const loader = vi.fn(later("v", 50));
    const [a, b] = await Promise.all([memoRefresh("k", 60_000, loader), memoRefresh("k", 60_000, loader)]);
    expect([a, b]).toEqual(["v", "v"]);
    expect(loader).toHaveBeenCalledTimes(1);
    await memoRefresh("k", 60_000, loader); // reused: loaded moments ago
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("a failed refresh leaves the cached value", async () => {
    await memoTtl("k", 60_000, later("old", 0));
    await expect(memoRefresh("k", 60_000, () => Promise.reject(new Error("rpc")))).rejects.toThrow("rpc");
    await expect(memoTtl("k", 60_000, later("x", 0))).resolves.toBe("old");
  });
});
