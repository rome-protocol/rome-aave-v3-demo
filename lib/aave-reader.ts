// Server-side viem reader. Composes registry config + on-chain reads into
// the JSON shape the design's data.jsx expects.

import { createPublicClient, http, type PublicClient } from "viem";
import { defineChain } from "viem";
import {
  getAaveDeployment,
  getChain,
  type AaveReserveEntry,
} from "./registry-config";
import { UiPoolDataProviderV3Abi, PoolAbi } from "./abi";

const SECONDS_PER_YEAR = 31_536_000n;
const RAY = 10n ** 27n;

function clientFor(chainId: number): PublicClient {
  const c = getChain(chainId);
  if (!c) throw new Error(`Unsupported chainId ${chainId}`);
  const viemChain = defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: [c.rpcUrl] } },
  });
  return createPublicClient({
    chain: viemChain,
    transport: http(c.rpcUrl),
  }) as PublicClient;
}

// Aave reports liquidityRate / variableBorrowRate as APR in ray (1e27).
// Compound APY from APR: (1 + APR/SECONDS_PER_YEAR)^SECONDS_PER_YEAR - 1.
// We approximate APY as APR for v1 — Aave's UI does the same compounding
// internally. Precise math can move into the demo later.
function rateRayToApr(ray: bigint): number {
  return Number(ray) / Number(RAY);
}

export interface ReserveSnapshot {
  // Maps onto the design's `RESERVES` entry shape (data.jsx).
  symbol: string;             // display symbol — UI-facing (USDC, ETH, SOL)
  name: string;               // friendly name
  decimals: number;
  iconKey: string;            // hint for icons.jsx
  priceUsd: number;
  totalSupply: number;
  totalSupplyUsd: number;
  totalBorrow: number;
  totalBorrowUsd: number;
  /**
   * Current pool cash — what's actually withdrawable/borrowable right now,
   * = aToken.totalSupply() − totalScaledVariableDebt × variableBorrowIndex / RAY.
   * Equals `totalSupply` when no debt is outstanding. UI uses this for the
   * pre-submit borrow liquidity guard so the user sees the real cap, not the
   * stale supplied amount.
   */
  availableLiquidity: number;
  supplyApy: number;
  borrowApy: number;
  utilization: number;
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

export interface DemoConfig {
  chain: {
    chainId: number;
    slug: string;
    displayName: string;
    env: "devnet" | "testnet" | "real-testnet" | "mainnet";
    nativeSymbol: string;
    solanaCluster: string;
    rpcUrl: string;
    evmExplorer: string;
    solanaExplorer: string;
    bridgeUrl: string;
    status: "live" | "degraded" | "unreachable";
  };
  reserves: ReserveSnapshot[];
  marketTotals: {
    totalSizeUsd: number;
    totalBorrowsUsd: number;
    availableUsd: number;
  };
  aaveAddresses: {
    pool: string;
    addressesProvider: string;
    poolConfigurator: string;
    aclManager: string;
    oracle: string;
    poolDataProvider: string;
    uiPoolDataProviderV3: string | null;
  };
  /**
   * E-mode categories configured on this Pool. Empty array means the
   * Pool ships with no categories — the dashboard EmodeCard then hides
   * the switch CTA.
   */
  emodeCategories: EmodeCategoryConfig[];
  // Generation timestamp + provenance.
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
  /** Display symbols of reserves enabled as collateral in this category. */
  collateralSymbols: string[];
  /** Display symbols of reserves borrowable in this category. */
  borrowableSymbols: string[];
}

function displayNameForChain(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function iconKeyForSymbol(displaySymbol: string): string {
  // The design's TOKEN_ICONS map has explicit logos for USDC / ETH / WBTC /
  // HEAT / SALT / MILK / OIL / SOL; unknown symbols fall back to LetterMark.
  return displaySymbol;
}

export async function buildDemoConfig(chainId: number): Promise<DemoConfig> {
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  if (!dep.uiPoolDataProviderV3) throw new Error("UiPoolDataProviderV3 not deployed");

  const client = clientFor(chainId);

  const [reservesData, baseCurrencyInfo] = (await client.readContract({
    address: dep.uiPoolDataProviderV3 as `0x${string}`,
    abi: UiPoolDataProviderV3Abi,
    functionName: "getReservesData",
    args: [dep.addressesProvider as `0x${string}`],
  })) as unknown as [Array<Record<string, any>>, Record<string, any>];

  // Aave reports prices in BASE_CURRENCY_UNIT (1e8 for USD-base setups).
  const BASE = Number(baseCurrencyInfo.marketReferenceCurrencyUnit ?? 100_000_000n);

  // Match each on-chain reserve back to its registry entry by underlying.
  const byUnderlying = new Map<string, AaveReserveEntry>(
    dep.reserves.map((r) => [r.underlying.toLowerCase(), r]),
  );

  const reserves: ReserveSnapshot[] = reservesData.map((r) => {
    const entry = byUnderlying.get((r.underlyingAsset as string).toLowerCase());
    const display = entry?.displaySymbol ?? r.symbol ?? "?";
    const decimals = Number(r.decimals ?? entry?.decimals ?? 18);

    const priceUsd = Number(r.priceInMarketReferenceCurrency) / BASE;
    const availableLiq = r.availableLiquidity as bigint;
    // Total scaled debt × variableBorrowIndex / RAY ≈ on-chain debt.
    const scaledDebt = r.totalScaledVariableDebt as bigint;
    const varBorrowIndex = r.variableBorrowIndex as bigint;
    const totalDebtRaw = (scaledDebt * varBorrowIndex) / RAY;
    const totalSupplyRaw = availableLiq + totalDebtRaw;

    const denom = 10 ** decimals;
    const totalSupply = Number(totalSupplyRaw) / denom;
    const totalBorrow = Number(totalDebtRaw) / denom;
    const availableLiquidity = Number(availableLiq) / denom;
    const totalSupplyUsd = totalSupply * priceUsd;
    const totalBorrowUsd = totalBorrow * priceUsd;
    const utilization = totalSupply > 0 ? totalBorrow / totalSupply : 0;

    const supplyApy = rateRayToApr(r.liquidityRate as bigint);
    const borrowApy = rateRayToApr(r.variableBorrowRate as bigint);

    return {
      symbol: display,
      name: r.name ?? display,
      decimals,
      iconKey: iconKeyForSymbol(display),
      priceUsd,
      totalSupply,
      totalSupplyUsd,
      totalBorrow,
      totalBorrowUsd,
      availableLiquidity,
      supplyApy,
      borrowApy,
      utilization,
      ltv: Number(r.baseLTVasCollateral) / 10_000,
      liqThreshold: Number(r.reserveLiquidationThreshold) / 10_000,
      liqBonus: (Number(r.reserveLiquidationBonus) - 10_000) / 10_000,
      reserveFactor: Number(r.reserveFactor) / 10_000,
      supplyCap: Number(r.supplyCap ?? 0n),
      borrowCap: Number(r.borrowCap ?? 0n),
      canBeCollateral: Boolean(r.usageAsCollateralEnabled),
      canBeBorrowed: Boolean(r.borrowingEnabled),
      isolation: (Number(r.debtCeiling ?? 0n) > 0),
      frozen: Boolean(r.isFrozen),
      emodeCategory: "—", // v3.6 moved e-mode out of the reserve struct — fetch via getEModes() if surfaced later
      optimalUsageRatio: Number(r.optimalUsageRatio) / 1e27,
      slope1: Number(r.variableRateSlope1) / 1e27,
      slope2: Number(r.variableRateSlope2) / 1e27,
      contract: r.underlyingAsset as string,
      aToken: r.aTokenAddress as string,
      varDebt: r.variableDebtTokenAddress as string,
      solanaMint: null,
    };
  });

  const marketTotals = reserves.reduce(
    (acc, r) => {
      acc.totalSizeUsd += r.totalSupplyUsd;
      acc.totalBorrowsUsd += r.totalBorrowUsd;
      return acc;
    },
    { totalSizeUsd: 0, totalBorrowsUsd: 0 },
  );

  const emodeCategories = await loadEmodeCategories(client, dep.pool as `0x${string}`, reserves);

  const chain = getChain(chainId);
  if (!chain) throw new Error(`No chain config for chain ${chainId}`);
  const evmExplorerBase = chain.explorerUrl.replace(/\/$/, "");

  return {
    chain: {
      chainId,
      slug: dep.chainSlug,
      displayName: chain.name,
      env: chain.network,
      nativeSymbol: chain.nativeCurrency.symbol,
      solanaCluster: chain.solana?.cluster ?? "devnet",
      rpcUrl: chain.rpcUrl,
      evmExplorer: `${evmExplorerBase}/tx/\${hash}`,
      solanaExplorer: `${chain.solana?.explorerUrl ?? "https://explorer.solana.com"}/tx/\${sig}?cluster=${chain.solana?.cluster ?? "devnet"}`,
      bridgeUrl: `https://bridge.${dep.chainSlug}.${chain.network}.romeprotocol.xyz`,
      status: chain.status === "live" ? "live" : "degraded",
    },
    reserves,
    marketTotals: { ...marketTotals, availableUsd: marketTotals.totalSizeUsd - marketTotals.totalBorrowsUsd },
    aaveAddresses: {
      pool: dep.pool,
      addressesProvider: dep.addressesProvider,
      poolConfigurator: dep.poolConfigurator,
      aclManager: dep.aclManager,
      oracle: dep.oracle,
      poolDataProvider: dep.poolDataProvider,
      uiPoolDataProviderV3: dep.uiPoolDataProviderV3,
    },
    emodeCategories,
    generatedAt: new Date().toISOString(),
    aave_v3_ref: dep.sourceCommits?.aave ?? "Aave v3@unknown",
  };
}

export async function loadUserAccountData(chainId: number, user: `0x${string}`) {
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  const client = clientFor(chainId);
  const [totalCollateralBase, totalDebtBase, availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor] = (await client.readContract({
    address: dep.pool as `0x${string}`,
    abi: PoolAbi,
    functionName: "getUserAccountData",
    args: [user],
  })) as unknown as [bigint, bigint, bigint, bigint, bigint, bigint];
  const BASE = 100_000_000n; // USD 8-dec
  return {
    netWorthUsd: Number(totalCollateralBase - totalDebtBase) / Number(BASE),
    totalCollateralUsd: Number(totalCollateralBase) / Number(BASE),
    totalDebtUsd: Number(totalDebtBase) / Number(BASE),
    availableBorrowsUsd: Number(availableBorrowsBase) / Number(BASE),
    currentLiquidationThreshold: Number(currentLiquidationThreshold) / 10_000,
    ltv: Number(ltv) / 10_000,
    healthFactor: healthFactor === 2n ** 256n - 1n ? Infinity : Number(healthFactor) / 1e18,
  };
}

// Shape returned by /api/user-data — composed of getUserReservesData for per-
// reserve positions + getUserAccountData for the aggregate + a wallet
// balanceOf for each reserve's underlying so the modal "Wallet: N" line is
// accurate.
export interface UserDataResponse {
  address: string;
  positions: Record<string, {
    walletBalance: number;
    suppliedBalance: number;
    debtBalance: number;
    isCollateral: boolean;
    borrowMode: "variable" | null;
  }>;
  aggregate: {
    netWorthUsd: number;
    totalCollateralUsd: number;
    totalDebtUsd: number;
    availableBorrowsUsd: number;
    ltv: number;
    // Average liquidation threshold across the user's enabled collateral
    // (weighted by USD value), fraction. HF = (totalCollateralUsd × this)
    // / totalDebtUsd; surfacing it lets ActionModal project a post-action
    // HF without a second RPC round-trip.
    currentLiquidationThreshold: number;
    healthFactor: number;
    /** User's active e-mode category. 0 = disabled. */
    userEmodeCategoryId: number;
  };
}

const ERC20_BALANCE_OF_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

/**
 * Composes one screen's worth of per-user data: per-reserve {wallet,supplied,debt}
 * + aggregate {netWorth,collat,debt,available,HF}. Pulls
 * UiPoolDataProviderV3.getUserReservesData (scaled balances + collat toggle)
 * + multicalls balanceOf for each underlying + Pool.getUserAccountData for
 * the aggregate.
 *
 * Wallet balance probe uses ERC20.balanceOf — for the cached SPL_ERC20
 * wrappers (wUSDC, wETH, wSOL) this returns the live cached balance.
 */
export async function loadFullUserData(chainId: number, user: `0x${string}`): Promise<UserDataResponse> {
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  if (!dep.uiPoolDataProviderV3) throw new Error("UiPoolDataProviderV3 not deployed");
  const client = clientFor(chainId);

  // 1. Per-reserve user-side state (scaled balances + collat toggle).
  const [userReserves, emodeId] = (await client.readContract({
    address: dep.uiPoolDataProviderV3 as `0x${string}`,
    abi: UiPoolDataProviderV3Abi,
    functionName: "getUserReservesData",
    args: [dep.addressesProvider as `0x${string}`, user],
  })) as unknown as [Array<{
    underlyingAsset: string;
    scaledATokenBalance: bigint;
    usageAsCollateralEnabledOnUser: boolean;
    scaledVariableDebt: bigint;
  }>, number];

  // 2. Reserve data — we need decimals + liquidity/variable-borrow indices
  //    to unscale balances into raw token units. /api/aave-config already
  //    computed this; we re-fetch it inline to keep this endpoint self-
  //    contained instead of cross-coupling cache shapes.
  const [reservesData] = (await client.readContract({
    address: dep.uiPoolDataProviderV3 as `0x${string}`,
    abi: UiPoolDataProviderV3Abi,
    functionName: "getReservesData",
    args: [dep.addressesProvider as `0x${string}`],
  })) as unknown as [Array<Record<string, any>>, Record<string, any>];

  const byUnderlying = new Map<string, { decimals: number; liquidityIndex: bigint; variableBorrowIndex: bigint; displaySymbol: string }>();
  for (const r of reservesData) {
    const entry = dep.reserves.find((d) => d.underlying.toLowerCase() === (r.underlyingAsset as string).toLowerCase());
    byUnderlying.set((r.underlyingAsset as string).toLowerCase(), {
      decimals: Number(r.decimals),
      liquidityIndex: r.liquidityIndex as bigint,
      variableBorrowIndex: r.variableBorrowIndex as bigint,
      displaySymbol: entry?.displaySymbol ?? (r.symbol as string),
    });
  }

  // 3. Wallet balanceOf per reserve. Sequential but ~7 reserves max so
  //    it's not worth a multicall round-trip for now.
  const walletBalances = await Promise.all(
    userReserves.map(async (ur) => {
      try {
        const bal = (await client.readContract({
          address: ur.underlyingAsset as `0x${string}`,
          abi: ERC20_BALANCE_OF_ABI,
          functionName: "balanceOf",
          args: [user],
        })) as unknown as bigint;
        return bal;
      } catch (e) {
        // Plain ERC20s pre-mint (e.g. before faucet claim) revert on balanceOf;
        // that's a deliberate "treat as 0" case so the response isn't poisoned.
        // A transport / RPC error is different — silently coercing it to 0
        // left the supply guard blocking a real holder under "Wallet: 0".
        // Re-throw so the API route surfaces an error banner instead of
        // misleading zero data.
        const name = (e as Error)?.name ?? "";
        const isRevert =
          name === "ContractFunctionExecutionError" || name === "ContractFunctionRevertedError";
        if (isRevert) return 0n;
        throw e;
      }
    }),
  );

  const positions: UserDataResponse["positions"] = {};
  for (let i = 0; i < userReserves.length; i++) {
    const ur = userReserves[i];
    const meta = byUnderlying.get(ur.underlyingAsset.toLowerCase());
    if (!meta) continue;
    const denom = 10 ** meta.decimals;
    const supplied = (ur.scaledATokenBalance * meta.liquidityIndex) / RAY;
    const debt = (ur.scaledVariableDebt * meta.variableBorrowIndex) / RAY;
    positions[meta.displaySymbol] = {
      walletBalance: Number(walletBalances[i]) / denom,
      suppliedBalance: Number(supplied) / denom,
      debtBalance: Number(debt) / denom,
      isCollateral: ur.usageAsCollateralEnabledOnUser,
      borrowMode: debt > 0n ? "variable" : null,
    };
  }

  // 4. Aggregate.
  const aggregate = await loadUserAccountData(chainId, user);

  return {
    address: user,
    positions,
    aggregate: {
      netWorthUsd: aggregate.netWorthUsd,
      totalCollateralUsd: aggregate.totalCollateralUsd,
      totalDebtUsd: aggregate.totalDebtUsd,
      availableBorrowsUsd: aggregate.availableBorrowsUsd,
      ltv: aggregate.ltv,
      currentLiquidationThreshold: aggregate.currentLiquidationThreshold,
      healthFactor: aggregate.healthFactor,
      userEmodeCategoryId: Number(emodeId),
    },
  };
}

// E-mode category discovery. Probes Pool.getEModeCategoryLabel(id) for
// id = 1..MAX_CATEGORY_PROBE in parallel; an empty label means the slot
// is unconfigured. For each present category, batch-fetches the
// collateralConfig + collateralBitmap + borrowableBitmap, then maps the
// bitmaps back to reserve display symbols using Pool.getReserveData(asset).id.

const MAX_CATEGORY_PROBE = 16; // V3.6 ABI allows uint8 = 0-255; 16 is a comfortable demo ceiling.

async function loadEmodeCategories(
  client: PublicClient,
  pool: `0x${string}`,
  reserves: ReserveSnapshot[],
): Promise<EmodeCategoryConfig[]> {
  // 1. Resolve each reserve's on-chain id (bitmap position) so we can
  //    map collateral/borrowable bitmaps back to display symbols.
  const reservePositions = await Promise.all(
    reserves.map(async (r): Promise<{ id: number; symbol: string }> => {
      const data = (await client.readContract({
        address: pool,
        abi: PoolAbi,
        functionName: "getReserveData",
        args: [r.contract as `0x${string}`],
      })) as { id: number };
      return { id: Number(data.id), symbol: r.symbol };
    }),
  );
  const symbolForBit = (bit: number): string | undefined =>
    reservePositions.find((p) => p.id === bit)?.symbol;

  // 2. Probe categories 1..N in parallel. Stop including any whose label
  //    comes back empty.
  const ids = Array.from({ length: MAX_CATEGORY_PROBE }, (_, i) => i + 1);
  const labels = await Promise.all(
    ids.map((id) =>
      client.readContract({
        address: pool,
        abi: PoolAbi,
        functionName: "getEModeCategoryLabel",
        args: [id],
      }) as Promise<string>,
    ),
  );

  const present = ids.filter((_, i) => labels[i] !== "" && labels[i] != null);
  if (present.length === 0) return [];

  // 3. For each present category, batch-fetch collateralConfig + bitmaps.
  const categories = await Promise.all(
    present.map(async (id): Promise<EmodeCategoryConfig> => {
      const [cfg, collatBitmap, borrowBitmap] = await Promise.all([
        client.readContract({
          address: pool,
          abi: PoolAbi,
          functionName: "getEModeCategoryCollateralConfig",
          args: [id],
        }) as Promise<{ ltv: number; liquidationThreshold: number; liquidationBonus: number }>,
        client.readContract({
          address: pool,
          abi: PoolAbi,
          functionName: "getEModeCategoryCollateralBitmap",
          args: [id],
        }) as Promise<bigint>,
        client.readContract({
          address: pool,
          abi: PoolAbi,
          functionName: "getEModeCategoryBorrowableBitmap",
          args: [id],
        }) as Promise<bigint>,
      ]);

      return {
        id,
        label: labels[ids.indexOf(id)],
        ltv: Number(cfg.ltv),
        liquidationThreshold: Number(cfg.liquidationThreshold),
        liquidationBonus: Number(cfg.liquidationBonus),
        collateralSymbols: bitmapToSymbols(collatBitmap, symbolForBit),
        borrowableSymbols: bitmapToSymbols(borrowBitmap, symbolForBit),
      };
    }),
  );

  return categories;
}

function bitmapToSymbols(bitmap: bigint, symbolForBit: (b: number) => string | undefined): string[] {
  const out: string[] = [];
  for (let bit = 0; bit < 128; bit++) {
    if ((bitmap >> BigInt(bit)) & 1n) {
      const sym = symbolForBit(bit);
      if (sym) out.push(sym);
    }
  }
  return out;
}
