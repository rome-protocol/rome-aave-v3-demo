import { describe, it, expect } from "vitest";
import {
  faucetTokenSymbols,
  faucetTokenDrops,
  type FaucetMeta,
} from "./faucet-config";

// A #240-shaped faucet meta (what getFaucetMeta returns for Hadrian today):
// 6 wrappers, 1 drop each, 0 native gas. The point of these helpers is that
// the faucet page copy is DERIVED from this — never the old hardcoded
// "100 of each mock token (HEAT / SALT / MILK / OIL)" string.
const meta: FaucetMeta = {
  chainId: 200010,
  address: "0xA24CB9b443F46aE205586Cd3dDF0447A9f295019",
  gasDropDisplay: "0",
  tokens: [
    { symbol: "BTC", name: "BTC", decimals: 9, address: "0xa1", dropDisplay: "1" },
    { symbol: "JitoSOL", name: "JitoSOL", decimals: 9, address: "0xa2", dropDisplay: "1" },
    { symbol: "mSOL", name: "mSOL", decimals: 9, address: "0xa3", dropDisplay: "1" },
  ],
};

describe("faucet copy derives from config", () => {
  it("faucetTokenSymbols lists the configured display symbols, ' / '-joined", () => {
    expect(faucetTokenSymbols(meta)).toBe("BTC / JitoSOL / mSOL");
  });

  it("faucetTokenDrops lists each drop amount + symbol, ', '-joined", () => {
    expect(faucetTokenDrops(meta)).toBe("1 BTC, 1 JitoSOL, 1 mSOL");
  });

  it("never reproduces the stale hardcoded mock-token copy", () => {
    const copy = `${faucetTokenSymbols(meta)} ${faucetTokenDrops(meta)}`;
    expect(copy).not.toMatch(/HEAT|SALT|MILK|OIL|100 of each/i);
  });

  it("handles a single-token faucet without a trailing separator", () => {
    expect(faucetTokenSymbols({ ...meta, tokens: [meta.tokens[0]] })).toBe("BTC");
  });
});
