import { describe, it, expect, vi } from "vitest";
import { getMarketOverview, isSupportedChain } from "./market-overview";

describe("unsupported chains", () => {
  it("start no refresh timer and keep no state", () => {
    vi.useFakeTimers();
    try {
      for (const id of [1, 2, 3.5]) {
        expect(isSupportedChain(id)).toBe(false);
        expect(getMarketOverview(id)).toBeNull();
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
