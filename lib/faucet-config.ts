// Reads the faucet block from the registry's apps/aave entry. Once
// @rome-protocol/registry v0.14.0 publishes, this swaps to:
//   import { getAaveDeployment } from "@rome-protocol/registry";
// For now we go through registry-config.ts which vendors the JSON.

import { getAaveDeployment, type AaveFaucetEntry } from "./registry-config";
import { formatUnits } from "viem";

export interface MockTokenMeta {
  symbol: string;
  name: string;
  decimals: number;
  address: string;
  dropDisplay: string;   // human-readable drop (e.g. "100")
}

export interface FaucetMeta {
  chainId: number;
  address: string;
  gasDropDisplay: string; // human-readable native amount ("10")
  tokens: MockTokenMeta[];
}

/**
 * Builds the demo's FaucetMeta from the registry entry. Returns undefined
 * when the chain's aave deployment has no faucet (mainnet won't).
 */
export function getFaucetMeta(chainId: number): FaucetMeta | undefined {
  const dep = getAaveDeployment(chainId);
  if (!dep?.faucet) return undefined;
  const faucet = dep.faucet as AaveFaucetEntry;

  // Decimals + display symbol come from the matching reserves[] entry,
  // keyed by underlying. This is also where the registry's vocabulary rule
  // ("display USDC not wUSDC") gets applied to the faucet UI.
  const reserveByUnderlying = new Map<string, { decimals: number; displaySymbol: string }>();
  for (const r of dep.reserves) {
    reserveByUnderlying.set(r.underlying.toLowerCase(), {
      decimals: r.decimals,
      displaySymbol: r.displaySymbol,
    });
  }

  return {
    chainId,
    address: faucet.address,
    gasDropDisplay: formatUnits(BigInt(faucet.gasDropWei), 18),
    tokens: faucet.tokens.map((t) => {
      const meta = reserveByUnderlying.get(t.address.toLowerCase());
      const decimals = meta?.decimals ?? 18;
      return {
        symbol: meta?.displaySymbol ?? t.symbol,
        name: meta?.displaySymbol ?? t.symbol,
        decimals,
        address: t.address,
        dropDisplay: formatUnits(BigInt(t.dropAmountWei), decimals),
      };
    }),
  };
}

/**
 * Faucet token symbols, " / "-joined (e.g. "BTC / JitoSOL / mSOL"). Derived
 * from the faucet config so the page copy can't go stale when the token set
 * changes (the old hardcoded "HEAT / SALT / MILK / OIL" copy is what this
 * replaces).
 */
export function faucetTokenSymbols(meta: FaucetMeta): string {
  return meta.tokens.map((t) => t.symbol).join(" / ");
}

/**
 * Faucet drops as "<amount> <symbol>", ", "-joined (e.g. "1 BTC, 1 JitoSOL").
 */
export function faucetTokenDrops(meta: FaucetMeta): string {
  return meta.tokens.map((t) => `${t.dropDisplay} ${t.symbol}`).join(", ");
}

export const FAUCET_ABI = [
  { type: "function", name: "claim",     stateMutability: "nonpayable", inputs: [],                                  outputs: [] },
  { type: "function", name: "claimed",   stateMutability: "view",       inputs: [{ name: "user", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokenList", stateMutability: "view",       inputs: [],                                  outputs: [{ type: "address[]" }] },
] as const;
