// Shared types for the Aave-on-Rome demo. Mirrors the shape returned by
// /api/aave-config + /api/user-data + /api/at-risk + /api/history.

export interface Reserve {
  symbol: string;        // display symbol — UI-facing (USDC, ETH, SOL, …)
  name: string;
  decimals: number;
  iconKey: string;
  priceUsd: number;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrow: number;
  totalBorrowUsd: number;
  /**
   * Current pool cash — what's actually borrowable / withdrawable right now.
   * = aToken.totalSupply − outstanding variable debt. Equals `totalSupply`
   * when no debt is outstanding. Drives ActionModal's borrow liquidity guard.
   */
  availableLiquidity: number;
  supplyApy: number;     // fraction (0.04 = 4%)
  borrowApy: number;
  utilization: number;   // fraction (0.5 = 50%)
  ltv: number;
  liqThreshold: number;
  liqBonus: number;
  reserveFactor: number;
  supplyCap: number;
  borrowCap: number;
  canBeCollateral: boolean;
  canBeBorrowed: boolean;
  isolation: boolean;
  frozen: boolean;
  emodeCategory: string;
  optimalUsageRatio: number;
  slope1: number;
  slope2: number;
  contract: string;
  aToken: string;
  varDebt: string;
  solanaMint: string | null;
}

export interface ChainInfo {
  chainId: number;
  slug: string;
  displayName: string;
  env: "devnet" | "testnet" | "real-testnet" | "mainnet";
  nativeSymbol: string;
  solanaCluster: string;
  rpcUrl: string;
  evmExplorer: string;   // template with literal "${hash}" placeholder
  solanaExplorer: string;
  bridgeUrl: string;
  status: "live" | "degraded" | "unreachable";
}

export interface MarketTotals {
  totalSizeUsd: number;
  totalBorrowsUsd: number;
  availableUsd: number;
}

export interface AaveAddresses {
  pool: string;
  addressesProvider: string;
  poolConfigurator: string;
  aclManager: string;
  oracle: string;
  poolDataProvider: string;
  uiPoolDataProviderV3: string | null;
}

export interface DemoConfig {
  chain: ChainInfo;
  reserves: Reserve[];
  marketTotals: MarketTotals;
  aaveAddresses: AaveAddresses;
  /** E-mode categories configured on this Pool. [] means no e-mode. */
  emodeCategories: EmodeCategoryConfig[];
  generatedAt: string;
  aave_v3_ref: string;
}

export interface EmodeCategoryConfig {
  id: number;
  label: string;
  /** LTV in BPS — divide by 10_000 for fraction. */
  ltv: number;
  /** Liquidation threshold in BPS. */
  liquidationThreshold: number;
  /** Liquidation bonus encoded as 10_000 + bonusBps; 10_100 = +1%. */
  liquidationBonus: number;
  collateralSymbols: string[];
  borrowableSymbols: string[];
}

export interface UserPosition {
  walletBalance: number;
  suppliedBalance: number;
  debtBalance: number;
  isCollateral: boolean;
  borrowMode: "variable" | null;
}

export interface UserAggregate {
  netWorthUsd: number;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  availableBorrowsUsd: number;
  ltv: number;
  // Average liquidation threshold across the user's enabled collateral
  // (USD-weighted, fraction — 0.78 = 78%). Drives HF projection in
  // ActionModal: projectedHf = (newCollat × newAvgLT) / newDebt.
  currentLiquidationThreshold: number;
  healthFactor: number;
  /** User's active e-mode category. 0 = disabled. */
  userEmodeCategoryId: number;
}

export interface UserData {
  address: string;
  positions: Record<string, UserPosition>;
  aggregate: UserAggregate;
}

export interface AtRiskRow {
  borrower: string;
  hf: number;
  collatSym: string;
  collatUsd: number;
  debtSym: string;
  debtUsd: number;
  bonusPct: number;
}

export interface HistoryRow {
  day: string;
  time: string;
  blockNumber: number;
  timestamp: number;
  action: "Supply" | "Withdraw" | "Borrow" | "Repay" | "FlashLoan" | "LiquidationCall";
  amount: number;
  symbol: string;
  /** Full 0x-prefixed EVM tx hash. Shorten in the UI for display. */
  evmHash: string;
  liqRole?: "liquidator" | "liquidatee";
}

// User-aggregate values computed in-UI from positions × reserves. Lower-
// fidelity than /api/user-data#aggregate (which calls Pool.getUserAccountData
// directly) but matches the design's mock layout.
export interface ComputedAggregates {
  suppliedUsd: number;
  debtUsd: number;
  collateralUsd: number;
  netWorth: number;
  hf: number;
  netSupplyApy: number;
  netBorrowApy: number;
  netApy: number;
  ltvPct: number;
}
