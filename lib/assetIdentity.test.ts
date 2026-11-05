import { describe, expect, it } from "vitest";
import { shownIdentity } from "./assetIdentity";

const wrapper = { symbol: "SOL", name: "Rome SOL" };
const sol = { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", source: "registry", logo: true };

describe("shownIdentity", () => {
  it("a Solana wallet sees the Solana name", () => {
    expect(shownIdentity("solana", sol, wrapper)).toEqual({ symbol: "SOL", name: "Solana" });
  });
  it("an EVM wallet, or none, keeps the wrapper's name", () => {
    expect(shownIdentity("evm", sol, wrapper)).toEqual(wrapper);
    expect(shownIdentity(null, sol, wrapper)).toEqual(wrapper);
  });
  it("a Solana wallet never sees the wrapper's name: unread mint, failed read, or no symbol found", () => {
    expect(shownIdentity("solana", null, wrapper)).toEqual({ symbol: "SOL", name: "" });
    expect(shownIdentity("solana", { ...sol, symbol: "6F5Y…XifWs", source: "none" }, wrapper)).toEqual({ symbol: "SOL", name: "" });
  });
  it("shows the symbol alone when the mint has no name, never the wrapper's", () => {
    expect(shownIdentity("solana", { ...sol, name: "" }, wrapper)).toEqual({ symbol: "SOL", name: "" });
  });
  it("an EVM wallet keeps the wrapper's name while nothing is read", () => {
    expect(shownIdentity("evm", null, wrapper)).toEqual(wrapper);
  });
});
