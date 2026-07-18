// Registry config loader. For now reads from the vendored copies of
// chains/<id-slug>/chain.json + apps/aave/<id-slug>.json. Once
// @rome-protocol/registry v0.13.0 publishes, this swaps to
// `import { getChain, getAaveDeployment } from "@rome-protocol/registry"`.

import hadrian from "./aave-hadrian.json";
import hadrianChainJson from "./hadrian-chain.json";
import type { ChainInfo } from "@/lib/types";

export interface ChainEntry {
  chainId: number;
  name: string;
  network: "mainnet" | "testnet" | "devnet" | "real-testnet";
  rpcUrl: string;
  explorerUrl: string;          // canonical from chain.json — e.g. https://via-hadrian.testnet.romeprotocol.xyz/
  nativeCurrency: { name: string; symbol: string; decimals: number };
  status: "live" | "preparing" | "retired";
  solana?: { cluster: string; explorerUrl: string };
}

// Default chain for this single-chain demo. Sourced from the vendored registry
// snapshot's chainId — never a bare literal. Override per-deploy with
// NEXT_PUBLIC_CHAIN_ID (build-inlined) when this app targets another chain.
export const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? hadrianChainJson.chainId);

const CHAINS: Record<number, ChainEntry> = {
  [hadrianChainJson.chainId]: hadrianChainJson as ChainEntry,
};

export function getChain(chainId: number): ChainEntry | undefined {
  return CHAINS[chainId];
}

/** Block-explorer URL for an EVM tx hash on the given chain. Strips trailing slash. */
export function evmExplorerTxUrl(chainId: number, txHash: string): string | undefined {
  const c = getChain(chainId);
  if (!c) return undefined;
  return `${c.explorerUrl.replace(/\/$/, "")}/tx/${txHash}`;
}

/** Solana explorer URL for a Solana signature on the chain's anchored cluster. */
export function solanaExplorerTxUrl(chainId: number, sig: string): string | undefined {
  const c = getChain(chainId);
  if (!c?.solana) return undefined;
  // explorer.solana.com is the canonical default; cluster query param routes
  // it to devnet / testnet / mainnet beta. The registry's chain.json sets
  // solana.cluster to whichever the Rome chain anchors against.
  const base = c.solana.explorerUrl.replace(/\/$/, "");
  return `${base}/tx/${sig}?cluster=${c.solana.cluster}`;
}

/** rome-via API base for a chain — the explorerUrl + /api/v1. */
export function romeViaApiBase(chainId: number): string | undefined {
  const c = getChain(chainId);
  if (!c) return undefined;
  return `${c.explorerUrl.replace(/\/$/, "")}/api/v1`;
}

export interface AaveReserveEntry {
  symbol: string;            // on-chain ERC20 symbol (e.g. "wUSDC")
  displaySymbol: string;     // UI-facing (e.g. "USDC") — per spec §3
  underlying: string;
  aToken: string;
  variableDebtToken: string;
  priceFeed: string;
  priceFeedKind: "pyth-pull" | "switchboard-v3" | "chainlink" | "mock-aggregator";
  decimals: number;
  ltv: number;
  liquidationThreshold: number;
  liquidationBonus: number;
}

export interface AaveDeployment {
  schemaVersion: "1";
  chainId: number;
  chainSlug: string;
  aaveVersion: string;
  addressesProvider: string;
  pool: string;
  poolConfigurator: string;
  aclManager: string;
  oracle: string;
  poolDataProvider: string;
  treasury: string | null;
  uiPoolDataProviderV3: string | null;
  walletBalanceProvider: string | null;
  rewards: string | null;
  irsConfig: {
    optimalUsageRatio: number;
    baseVariableBorrowRate: number;
    variableRateSlope1: number;
    variableRateSlope2: number;
  };
  reserves: AaveReserveEntry[];
  faucet?: AaveFaucetEntry;
  jito: { enabled: boolean; reason?: string; endpoint?: string | null };
  ux: { singleTxFlows: string[]; bundleFlows: string[]; fallbackFlows: string[] };
  demoUrl: string;
  rpcRef: string;
  deployedAt: string;
  sourceCommits?: Record<string, string>;
  status: "live" | "retired" | "draft";
  notes?: string;
}

export interface AaveFaucetEntry {
  address: string;
  /** Native gas dropped per claim, in wei (decimal string for big-int safety). */
  gasDropWei: string;
  tokens: Array<{
    symbol: string;
    address: string;
    /** Raw token-unit drop per claim (decimal string). */
    dropAmountWei: string;
  }>;
}

const DEPLOYMENTS: Record<number, AaveDeployment> = {
  [hadrian.chainId]: hadrian as AaveDeployment,
};

export function getAaveDeployment(chainId: number): AaveDeployment | undefined {
  return DEPLOYMENTS[chainId];
}

/**
 * Minimal ChainInfo for loading / error skeletons — derived from the registry
 * snapshot so the placeholder is never a hardcoded dev stub. URLs are blank
 * (skeletons don't link out); real /api/aave-config data replaces it on load.
 */
export const fallbackChainInfo: ChainInfo = {
  chainId: DEFAULT_CHAIN_ID,
  slug: getAaveDeployment(DEFAULT_CHAIN_ID)?.chainSlug ?? "",
  displayName: getChain(DEFAULT_CHAIN_ID)?.name ?? "",
  env: (getChain(DEFAULT_CHAIN_ID)?.network ?? "testnet") as ChainInfo["env"],
  nativeSymbol: getChain(DEFAULT_CHAIN_ID)?.nativeCurrency.symbol ?? "",
  solanaCluster: getChain(DEFAULT_CHAIN_ID)?.solana?.cluster ?? "devnet",
  rpcUrl: "",
  evmExplorer: "",
  solanaExplorer: "",
  bridgeUrl: "",
  status: "live",
};
