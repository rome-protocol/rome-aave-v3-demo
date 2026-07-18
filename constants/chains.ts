// Minimal RomeChain shape lifted from the Rome web app — single-chain (Hadrian)
// version for the Aave V3 demo. Wide-multi-chain machinery is intentionally
// not ported because the demo only ever talks to one chain. If we add
// chains here, this file must mirror the the Rome web app shape so the lifted
// walletStore + evmChainSwitch keep working without changes.

import hadrianChainJson from "@/lib/hadrian-chain.json";

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface RomeChainContracts {
  multicall?: string;
}

export interface RomeChain {
  chainId: string;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: NativeCurrency;
  contracts: RomeChainContracts;
}

const DEFAULT_NATIVE_CURRENCY: NativeCurrency = {
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
};

function getWalletNativeCurrency(input?: NativeCurrency): NativeCurrency {
  if (!input) return DEFAULT_NATIVE_CURRENCY;
  return {
    name: input.name || DEFAULT_NATIVE_CURRENCY.name,
    symbol: input.symbol || DEFAULT_NATIVE_CURRENCY.symbol,
    decimals: input.decimals ?? DEFAULT_NATIVE_CURRENCY.decimals,
  };
}

// Viem-shaped Chain returned by createCustomChain — matches what the lifted
// utils/evmChainSwitch.ts expects. Trimmed `Chain` type from `viem` (kept
// inline so we don't take a viem type-only dep here).
export interface ViemChainShape {
  id: number;
  name: string;
  nativeCurrency: NativeCurrency;
  rpcUrls: { default: { http: readonly [string] }; public: { http: readonly [string] } };
  blockExplorers: { default: { name: string; url: string } };
  contracts?: { multicall3: { address: `0x${string}` } };
}

export const createCustomChain = (
  chainId: string,
  rpcUrl: string,
  name?: string,
  explorerUrl?: string,
  nativeCurrency?: NativeCurrency,
  multicallAddress?: string,
): ViemChainShape => {
  const chainName = name || `Rome L2_${chainId}`;
  const currency = getWalletNativeCurrency(nativeCurrency);
  const contracts =
    multicallAddress && multicallAddress.length > 0
      ? { multicall3: { address: multicallAddress as `0x${string}` } }
      : undefined;

  return {
    id: Number(chainId),
    name: chainName,
    nativeCurrency: currency,
    rpcUrls: {
      default: { http: [rpcUrl] as const },
      public: { http: [rpcUrl] as const },
    },
    blockExplorers: {
      default: { name: `${chainName} Explorer`, url: explorerUrl || "" },
    },
    ...(contracts ? { contracts } : {}),
  };
};

// Single-chain list: just Hadrian. If the demo ever supports multiple
// chains, fetch from the registry here (the Rome web app does this via /api/chains).
export const L2_CHAINS: RomeChain[] = [
  {
    chainId: String(hadrianChainJson.chainId),
    name: hadrianChainJson.name,
    rpcUrl: hadrianChainJson.rpcUrl,
    explorerUrl: hadrianChainJson.explorerUrl,
    nativeCurrency: hadrianChainJson.nativeCurrency,
    contracts: {},
  },
];
