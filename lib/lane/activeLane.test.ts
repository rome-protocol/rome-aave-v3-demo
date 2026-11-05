import { describe, expect, it } from "vitest";
import { decideActiveLane } from "./activeLane";

describe("decideActiveLane", () => {
  it("the only connected wallet is active, whatever the stored preference says", () => {
    expect(decideActiveLane({ evmConnected: true, solanaConnected: false }, "solana")).toEqual({ active: "evm", evict: null });
    expect(decideActiveLane({ evmConnected: false, solanaConnected: true }, "evm")).toEqual({ active: "solana", evict: null });
  });
  it("nothing connected → nothing active, nothing evicted", () => {
    expect(decideActiveLane({ evmConnected: false, solanaConnected: false }, "evm")).toEqual({ active: null, evict: null });
  });
  it("both connected + a preference → the preference wins and the other is evicted", () => {
    expect(decideActiveLane({ evmConnected: true, solanaConnected: true }, "evm")).toEqual({ active: "evm", evict: "solana" });
    expect(decideActiveLane({ evmConnected: true, solanaConnected: true }, "solana")).toEqual({ active: "solana", evict: "evm" });
  });
  it("both connected + no preference → refuses to guess: null active, no eviction", () => {
    expect(decideActiveLane({ evmConnected: true, solanaConnected: true }, null)).toEqual({ active: null, evict: null });
  });
});
