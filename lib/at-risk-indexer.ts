// At-risk borrower feed for /liquidate.
//
// Architecture:
// 1. Maintain a process-wide cache per chain: { borrowers: Set, lastBlock }.
//    Borrowers come from Pool.Borrow events (indexed topic 2 = onBehalfOf).
// 2. On each /api/at-risk request, top up the borrower set with new
//    Borrow events since lastBlock, then call Pool.getUserAccountData for
//    every known borrower in a small concurrent batch.
// 3. Filter to HF ≤ HF_THRESHOLD, decorate each with the borrower's
//    biggest collat + biggest variable debt position via
//    UiPoolDataProviderV3.getUserReservesData.
// 4. TTL the decorated result (the expensive part) for 12s so a busy
//    page doesn't refetch every render. The borrower set itself is
//    append-only — re-scans are cheap.
//
// Scope notes:
// - HF_THRESHOLD includes the buffer zone (1.0-1.05) the design surfaces
//   so users see positions trending toward unsafe; the row's "Liquidate"
//   button at the UI layer disables when HF >= 1.
// - eth_getLogs is bounded to BLOCK_SCAN_CHUNK so we never request a
//   range the Rome RPC will reject. Index since deployedAt is sliced
//   automatically.

import { createPublicClient, http, defineChain, parseAbiItem, type Address, type PublicClient } from "viem";
import { getAaveDeployment, getChain } from "./registry-config";
import { PoolAbi, UiPoolDataProviderV3Abi } from "./abi";

const HF_THRESHOLD = 1.05;
const BLOCK_SCAN_CHUNK = 5_000n;
const DECORATE_CACHE_MS = 6_000;
const RAY = 10n ** 27n;

interface IndexerState {
  borrowers: Set<string>;
  lastScannedBlock: bigint;
}

const STATE_BY_CHAIN = new Map<number, IndexerState>();

interface DecorateCacheEntry {
  rows: AtRiskRow[];
  generatedAt: number;
  scannedBlock: string;
}
const DECORATE_CACHE = new Map<number, DecorateCacheEntry>();

export interface AtRiskRow {
  borrower: string;
  hf: number;
  collatSym: string;
  collatUsd: number;
  debtSym: string;
  debtUsd: number;
  bonusPct: number; // collateral reserve's liquidationBonus, as a fraction (0.05 = 5%)
}

function clientFor(chainId: number): PublicClient {
  const c = getChain(chainId);
  if (!c) throw new Error(`Unsupported chainId ${chainId}`);
  const viemChain = defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: [c.rpcUrl] } },
  });
  return createPublicClient({ chain: viemChain, transport: http(c.rpcUrl) }) as PublicClient;
}

async function _scanBorrowEvents(client: PublicClient, pool: Address, fromBlock: bigint, toBlock: bigint): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = fromBlock; start <= toBlock; start += BLOCK_SCAN_CHUNK) {
    const end = start + BLOCK_SCAN_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_SCAN_CHUNK - 1n;
    const logs = await client.getLogs({
      address: pool,
      event: parseAbiItem(
        "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
      ),
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs) {
      const onBehalfOf = (log.args as { onBehalfOf?: string })?.onBehalfOf;
      if (onBehalfOf) found.add(onBehalfOf.toLowerCase());
    }
  }
  return found;
}

async function _ensureState(chainId: number): Promise<IndexerState> {
  let state = STATE_BY_CHAIN.get(chainId);
  if (state) return state;
  // First-time: scan from chain genesis (or the Aave deploy block if we
  // ever index it in the registry — for now genesis is fine, Hadrian is
  // fresh and the scan is bounded by BLOCK_SCAN_CHUNK steps).
  state = { borrowers: new Set(), lastScannedBlock: 0n };
  STATE_BY_CHAIN.set(chainId, state);
  return state;
}

async function _topUpBorrowers(chainId: number): Promise<IndexerState> {
  const state = await _ensureState(chainId);
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  const client = clientFor(chainId);
  const currentBlock = await client.getBlockNumber();
  if (state.lastScannedBlock >= currentBlock) return state;

  const from = state.lastScannedBlock === 0n ? 0n : state.lastScannedBlock + 1n;
  const newBorrowers = await _scanBorrowEvents(client, dep.pool as Address, from, currentBlock);
  for (const b of newBorrowers) state.borrowers.add(b);
  state.lastScannedBlock = currentBlock;
  return state;
}

/**
 * Pick the borrower's largest collateral position + largest variable-debt
 * position, scale them out of RAY using the corresponding reserve indices,
 * convert to USD via the reserve's priceInMarketReferenceCurrency.
 *
 * Returns null when the borrower has no debt — they've been repaid; remove
 * from the cache on the next pass.
 */
function _summarizePositions(
  userReserves: Array<{
    underlyingAsset: string;
    scaledATokenBalance: bigint;
    usageAsCollateralEnabledOnUser: boolean;
    scaledVariableDebt: bigint;
  }>,
  reservesByAddr: Map<
    string,
    { decimals: number; liquidityIndex: bigint; variableBorrowIndex: bigint; priceInRef: bigint; refUnit: bigint; displaySymbol: string; liqBonusBps: number }
  >,
): { collatSym: string; collatUsd: number; debtSym: string; debtUsd: number; bonusPct: number } | null {
  let bestCollat: { sym: string; usd: number; bonusPct: number } | null = null;
  let bestDebt: { sym: string; usd: number } | null = null;

  for (const ur of userReserves) {
    const meta = reservesByAddr.get(ur.underlyingAsset.toLowerCase());
    if (!meta) continue;
    const denom = 10 ** meta.decimals;

    if (ur.usageAsCollateralEnabledOnUser && ur.scaledATokenBalance > 0n) {
      const tokens = Number((ur.scaledATokenBalance * meta.liquidityIndex) / RAY) / denom;
      // refUnit is marketReferenceCurrencyUnit — a constant 1e8 in practice,
      // but a broken oracle can read back 0n. Guard so we don't surface
      // Infinity/NaN on the liquidate feed.
      const refUnit = Number(meta.refUnit);
      const usd = refUnit > 0 ? (tokens * Number(meta.priceInRef)) / refUnit : 0;
      if (!bestCollat || usd > bestCollat.usd) {
        bestCollat = {
          sym: meta.displaySymbol,
          usd,
          bonusPct: (meta.liqBonusBps - 10_000) / 10_000,
        };
      }
    }

    if (ur.scaledVariableDebt > 0n) {
      const tokens = Number((ur.scaledVariableDebt * meta.variableBorrowIndex) / RAY) / denom;
      const refUnit = Number(meta.refUnit);
      const usd = refUnit > 0 ? (tokens * Number(meta.priceInRef)) / refUnit : 0;
      if (!bestDebt || usd > bestDebt.usd) {
        bestDebt = { sym: meta.displaySymbol, usd };
      }
    }
  }

  if (!bestDebt) return null;
  return {
    collatSym: bestCollat?.sym ?? "—",
    collatUsd: bestCollat?.usd ?? 0,
    debtSym: bestDebt.sym,
    debtUsd: bestDebt.usd,
    bonusPct: bestCollat?.bonusPct ?? 0,
  };
}

export async function loadAtRiskFeed(chainId: number, opts: { hfMax?: number } = {}): Promise<{
  rows: AtRiskRow[];
  generatedAt: string;
  scannedBlock: string;
  borrowerCount: number;
}> {
  const hfMax = opts.hfMax ?? HF_THRESHOLD;

  // TTL cache the decorated result. Borrower set top-ups still happen on
  // every request — that piece is bounded by getLogs + cheap, and we want
  // to catch fresh borrowers immediately. The expensive part is the
  // per-borrower getUserAccountData + getUserReservesData fan-out, which
  // is what the TTL guards.
  const cached = DECORATE_CACHE.get(chainId);
  if (cached && Date.now() - cached.generatedAt < DECORATE_CACHE_MS) {
    return {
      rows: cached.rows.filter((r) => r.hf <= hfMax),
      generatedAt: new Date(cached.generatedAt).toISOString(),
      scannedBlock: cached.scannedBlock,
      borrowerCount: STATE_BY_CHAIN.get(chainId)?.borrowers.size ?? 0,
    };
  }

  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  if (!dep.uiPoolDataProviderV3) throw new Error("UiPoolDataProviderV3 not deployed");
  const client = clientFor(chainId);

  // Build the reserve metadata index once per refresh. getReservesData
  // returns [reserves[], baseCurrencyInfo] — destructure BOTH from a single
  // call (a prior version fetched it twice, doubling the round-trip and
  // risking a split-block snapshot between the two reads).
  const [reservesData, baseCurrencyInfo] = (await client.readContract({
    address: dep.uiPoolDataProviderV3 as Address,
    abi: UiPoolDataProviderV3Abi,
    functionName: "getReservesData",
    args: [dep.addressesProvider as Address],
  })) as unknown as [Array<Record<string, unknown>>, { marketReferenceCurrencyUnit: bigint }];

  const reservesByAddr = new Map<
    string,
    { decimals: number; liquidityIndex: bigint; variableBorrowIndex: bigint; priceInRef: bigint; refUnit: bigint; displaySymbol: string; liqBonusBps: number }
  >();
  // Reference unit (1 USD in BASE_CURRENCY decimals — usually 1e8 on Aave).
  const refUnit = baseCurrencyInfo.marketReferenceCurrencyUnit;

  for (const r of reservesData) {
    const entry = dep.reserves.find(
      (d) => d.underlying.toLowerCase() === (r.underlyingAsset as string).toLowerCase(),
    );
    reservesByAddr.set((r.underlyingAsset as string).toLowerCase(), {
      decimals: Number(r.decimals),
      liquidityIndex: r.liquidityIndex as bigint,
      variableBorrowIndex: r.variableBorrowIndex as bigint,
      priceInRef: r.priceInMarketReferenceCurrency as bigint,
      refUnit,
      displaySymbol: entry?.displaySymbol ?? (r.symbol as string),
      liqBonusBps: entry?.liquidationBonus ?? 10_000,
    });
  }

  // Top up the borrower set + fan-out HF reads.
  const state = await _topUpBorrowers(chainId);
  const borrowers = Array.from(state.borrowers) as Address[];

  const rows: AtRiskRow[] = [];
  const concurrency = 8;
  for (let i = 0; i < borrowers.length; i += concurrency) {
    const slice = borrowers.slice(i, i + concurrency);
    const chunkResults = await Promise.all(
      slice.map(async (borrower) => {
        try {
          const [, totalDebtBase, , , , healthFactor] = (await client.readContract({
            address: dep.pool as Address,
            abi: PoolAbi,
            functionName: "getUserAccountData",
            args: [borrower],
          })) as unknown as [bigint, bigint, bigint, bigint, bigint, bigint];
          if (totalDebtBase === 0n) return null; // repaid
          const hf = healthFactor === 2n ** 256n - 1n ? Infinity : Number(healthFactor) / 1e18;
          if (hf > HF_THRESHOLD) return null;

          // Decorate with positions only when the borrower is actually
          // at-risk — that's the long tail and it's expensive.
          const [userReserves] = (await client.readContract({
            address: dep.uiPoolDataProviderV3 as Address,
            abi: UiPoolDataProviderV3Abi,
            functionName: "getUserReservesData",
            args: [dep.addressesProvider as Address, borrower],
          })) as unknown as [
            Array<{
              underlyingAsset: string;
              scaledATokenBalance: bigint;
              usageAsCollateralEnabledOnUser: boolean;
              scaledVariableDebt: bigint;
            }>,
            number,
          ];
          const positions = _summarizePositions(userReserves, reservesByAddr);
          if (!positions) return null;
          return { borrower, hf, ...positions } as AtRiskRow;
        } catch (e) {
          // Borrower may have hit a recent revert (genuine state issue) OR a
          // transport blip. Skip the row either way so the feed doesn't fail
          // wholesale, but log transport errors so a sustained outage (which
          // would silently shrink the feed) shows up in ops logs.
          const name = (e as Error)?.name ?? "";
          const isRevert =
            name === "ContractFunctionExecutionError" || name === "ContractFunctionRevertedError";
          if (!isRevert) {
            console.warn(
              `[at-risk] transport error decorating borrower ${borrower} — dropped from feed. ` +
                `Cause: ${(e as Error)?.message ?? e}`,
            );
          }
          return null;
        }
      }),
    );
    for (const r of chunkResults) if (r) rows.push(r);
  }

  // Sort by HF ascending — most-at-risk first, since liquidators care
  // about under-1 first, then trending-bad next.
  rows.sort((a, b) => a.hf - b.hf);

  const generatedAt = Date.now();
  DECORATE_CACHE.set(chainId, {
    rows,
    generatedAt,
    scannedBlock: state.lastScannedBlock.toString(),
  });

  return {
    rows: rows.filter((r) => r.hf <= hfMax),
    generatedAt: new Date(generatedAt).toISOString(),
    scannedBlock: state.lastScannedBlock.toString(),
    borrowerCount: state.borrowers.size,
  };
}
