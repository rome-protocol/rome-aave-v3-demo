// At-risk borrower feed for /liquidate.
//
// Architecture:
// 1. Maintain a process-wide cache per chain: { borrowers: Set, lastBlock }.
//    Borrowers come from Pool.Borrow events (indexed topic 2 = onBehalfOf).
// 2. A warm feed per chain (lib/warm-feed.ts) rebuilds the list in the background every
//    REFRESH_MS: top up the borrower set, read Pool.getUserAccountData for every borrower through
//    Multicall3, then UiPoolDataProviderV3.getUserReservesData (also batched) only for borrowers
//    with HF <= HF_CEILING.
// 3. A request answers from the warm list at once; only the very first one waits for a build.
//    After a liquidation the page asks for one borrower to be re-read (`refresh`), which patches that row.
//
// Scope notes:
// - HF_CEILING is the widest band the feed carries (the page filters it down);
//   the row's "Liquidate" button at the UI layer is enabled only when HF < 1.
// - The borrower scan starts at the pool's deploy block and uses address-filtered
//   eth_getLogs windows of at most SCAN_WINDOW blocks (inclusive); the Hadrian
//   proxy refuses wider ranges. Concurrent requests share one in-flight scan.
// - A failed read (including a contract revert) keeps the borrower's last good row and is retried;
//   only a definite answer (repaid, above the ceiling, no debt) drops a row (see at-risk-refresh.ts).
//   `stale` counts the rows that are kept from an earlier build.

import { createPublicClient, http, defineChain, parseAbi, parseAbiItem, encodeFunctionData, decodeFunctionResult, type Address, type Hex, type PublicClient } from "viem";
import { getAaveDeployment, getChain } from "./registry-config";
import { PoolAbi, UiPoolDataProviderV3Abi } from "./abi";
import { blockWindows, refreshRowsBatched, type Read } from "./at-risk-refresh";
import { POOL_DEPLOY_BLOCK } from "./pool-deploy-block";
import { createWarmFeed, type WarmFeed } from "./warm-feed";

const HF_CEILING = 2;
const SCAN_WINDOW = 1_000_000n;
const REFRESH_MS = 15_000;
const BATCH_SIZE = 20;
const MulticallAbi = parseAbi(["function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)"]);
const RAY = 10n ** 27n;

interface IndexerState {
  borrowers: Set<string>;
  lastScannedBlock: bigint;
}

const STATE_BY_CHAIN = new Map<number, IndexerState>();

// Last good row per borrower, per chain: survives a failed read.
const LAST_GOOD = new Map<number, Map<string, AtRiskRow>>();

export interface AtRiskRow {
  borrower: string;
  hf: number;
  collatSym: string;
  collatUsd: number;
  debtSym: string; // the borrower's largest debt asset
  debtUsd: number; // total debt, all assets
  debtAssetUsd: number; // debt in debtSym only
  bonusPct: number; // collateral reserve's liquidationBonus, as a fraction (0.05 = 5%)
}

/** True when the registry snapshot knows the chain and its Aave deployment. */
export function isSupportedChain(chainId: number): boolean {
  return !!getChain(chainId) && !!getAaveDeployment(chainId);
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

const BORROW_EVENT = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

/** Last block the at-risk indexer has scanned (0 before the first scan). For /api/status. */
export function getAtRiskLastScannedBlock(chainId: number): bigint {
  return STATE_BY_CHAIN.get(chainId)?.lastScannedBlock ?? 0n;
}

function _ensureState(chainId: number): IndexerState {
  let state = STATE_BY_CHAIN.get(chainId);
  if (!state) {
    // lastScannedBlock is the last block fully scanned; start just before the pool's deploy block.
    state = { borrowers: new Set(), lastScannedBlock: POOL_DEPLOY_BLOCK - 1n };
    STATE_BY_CHAIN.set(chainId, state);
  }
  return state;
}

// One scan per chain at a time: concurrent requests await the same promise.
const SCAN_IN_FLIGHT = new Map<number, Promise<IndexerState>>();

function _topUpBorrowers(chainId: number): Promise<IndexerState> {
  let p = SCAN_IN_FLIGHT.get(chainId);
  if (!p) {
    p = _scan(chainId).finally(() => SCAN_IN_FLIGHT.delete(chainId));
    SCAN_IN_FLIGHT.set(chainId, p);
  }
  return p;
}

async function _scan(chainId: number): Promise<IndexerState> {
  const state = _ensureState(chainId);
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  const client = clientFor(chainId);
  const currentBlock = await client.getBlockNumber();
  // Progress is saved after every window, so a failure keeps what was already scanned.
  for (const [from, to] of blockWindows(state.lastScannedBlock + 1n, currentBlock, SCAN_WINDOW)) {
    const logs = await client.getLogs({ address: dep.pool as Address, event: BORROW_EVENT, fromBlock: from, toBlock: to });
    for (const log of logs) {
      const onBehalfOf = (log.args as { onBehalfOf?: string })?.onBehalfOf;
      if (onBehalfOf) state.borrowers.add(onBehalfOf.toLowerCase());
    }
    state.lastScannedBlock = to;
  }
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
): { collatSym: string; collatUsd: number; debtSym: string; debtUsd: number; debtAssetUsd: number; bonusPct: number } | null {
  let bestCollat: { sym: string; usd: number; bonusPct: number } | null = null;
  let bestDebt: { sym: string; usd: number } | null = null;
  let totalDebtUsd = 0;

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
      totalDebtUsd += usd;
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
    debtUsd: totalDebtUsd,
    debtAssetUsd: bestDebt.usd,
    bonusPct: bestCollat?.bonusPct ?? 0,
  };
}

type FeedResult = { rows: AtRiskRow[]; scannedBlock: string; borrowerCount: number; stale: number };
type ReserveInfo = { decimals: number; liquidityIndex: bigint; variableBorrowIndex: bigint; priceInRef: bigint; refUnit: bigint; displaySymbol: string; liqBonusBps: number };
type ReserveMeta = Map<string, ReserveInfo>;
type UserReserves = Parameters<typeof _summarizePositions>[0];

const WARM = new Map<number, WarmFeed<FeedResult>>();
// Reserve metadata from the last build; a single-borrower re-read reuses it.
const RESERVES = new Map<number, ReserveMeta>();

/** Several eth_calls in one: results line up with `calls`; a failed sub-call has success=false. */
async function multicall(chainId: number, client: PublicClient, calls: Array<{ target: Address; callData: Hex }>): Promise<Array<{ success: boolean; returnData: Hex }>> {
  const address = getChain(chainId)?.multicall3;
  if (!address) throw new Error(`No Multicall3 for chain ${chainId}`);
  return (await client.readContract({
    address: address as Address,
    abi: MulticallAbi,
    functionName: "aggregate3",
    args: [calls.map((c) => ({ ...c, allowFailure: true }))],
  })) as unknown as Array<{ success: boolean; returnData: Hex }>;
}

function decodeEach<T>(results: Array<{ success: boolean; returnData: Hex }>, decode: (data: Hex) => T): Array<Read<T>> {
  return results.map((r): Read<T> => {
    if (!r.success) return { ok: false };
    try {
      return { ok: true, value: decode(r.returnData) };
    } catch {
      return { ok: false };
    }
  });
}

async function readReserves(chainId: number, client: PublicClient): Promise<ReserveMeta> {
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  if (!dep.uiPoolDataProviderV3) throw new Error("UiPoolDataProviderV3 not deployed");
  // getReservesData returns [reserves[], baseCurrencyInfo]; one call, so both come from the same block.
  const [reservesData, baseCurrencyInfo] = (await client.readContract({
    address: dep.uiPoolDataProviderV3 as Address,
    abi: UiPoolDataProviderV3Abi,
    functionName: "getReservesData",
    args: [dep.addressesProvider as Address],
  })) as unknown as [Array<Record<string, unknown>>, { marketReferenceCurrencyUnit: bigint }];

  const meta: ReserveMeta = new Map();
  // Reference unit (1 USD in BASE_CURRENCY decimals, usually 1e8 on Aave).
  const refUnit = baseCurrencyInfo.marketReferenceCurrencyUnit;
  for (const r of reservesData) {
    const entry = dep.reserves.find((d) => d.underlying.toLowerCase() === (r.underlyingAsset as string).toLowerCase());
    meta.set((r.underlyingAsset as string).toLowerCase(), {
      decimals: Number(r.decimals),
      liquidityIndex: r.liquidityIndex as bigint,
      variableBorrowIndex: r.variableBorrowIndex as bigint,
      priceInRef: r.priceInMarketReferenceCurrency as bigint,
      refUnit,
      displaySymbol: entry?.displaySymbol ?? (r.symbol as string),
      liqBonusBps: entry?.liquidationBonus ?? 10_000,
    });
  }
  return meta;
}

/** Re-read `borrowers` (health for all, positions for those inside the band), keeping last good rows on a failed read. */
function readBorrowers(chainId: number, client: PublicClient, meta: ReserveMeta, borrowers: string[]) {
  const dep = getAaveDeployment(chainId)!;
  const lastGood = LAST_GOOD.get(chainId) ?? new Map<string, AtRiskRow>();
  LAST_GOOD.set(chainId, lastGood);

  return refreshRowsBatched<{ hf: number; debt: bigint }, UserReserves, AtRiskRow>({
    borrowers,
    batchSize: BATCH_SIZE,
    readHealth: async (batch) => {
      const res = await multicall(chainId,
        client,
        batch.map((b) => ({ target: dep.pool as Address, callData: encodeFunctionData({ abi: PoolAbi, functionName: "getUserAccountData", args: [b as Address] }) })),
      );
      return decodeEach(res, (data) => {
        const [, debt, , , , healthFactor] = decodeFunctionResult({ abi: PoolAbi, functionName: "getUserAccountData", data }) as unknown as bigint[];
        return { debt, hf: healthFactor === 2n ** 256n - 1n ? Infinity : Number(healthFactor) / 1e18 };
      });
    },
    // Positions are read only for borrowers inside the widest band the page shows.
    inBand: (h) => h.debt > 0n && h.hf <= HF_CEILING,
    readPositions: async (batch) => {
      const res = await multicall(chainId,
        client,
        batch.map((b) => ({
          target: dep.uiPoolDataProviderV3 as Address,
          callData: encodeFunctionData({ abi: UiPoolDataProviderV3Abi, functionName: "getUserReservesData", args: [dep.addressesProvider as Address, b as Address] }),
        })),
      );
      return decodeEach(res, (data) => (decodeFunctionResult({ abi: UiPoolDataProviderV3Abi, functionName: "getUserReservesData", data }) as unknown as [UserReserves, number])[0]);
    },
    toRow: (borrower, h, userReserves) => {
      const positions = _summarizePositions(userReserves, meta);
      return positions ? { borrower, hf: h.hf, ...positions } : null;
    },
    lastGood,
  });
}

async function buildFeed(chainId: number): Promise<FeedResult> {
  const client = clientFor(chainId);
  const meta = await readReserves(chainId, client);
  RESERVES.set(chainId, meta);

  // A failed scan keeps the borrowers already known; the next build resumes after lastScannedBlock.
  const state = await _topUpBorrowers(chainId).catch((e: unknown) => {
    console.warn("[at-risk] borrower scan failed, using the known set:", e instanceof Error ? e.message : e);
    return _ensureState(chainId);
  });

  const { rows, failed } = await readBorrowers(chainId, client, meta, Array.from(state.borrowers));
  // Most-at-risk first: liquidators care about under-1 first, then trending-bad.
  rows.sort((a, b) => a.hf - b.hf);
  return { rows, scannedBlock: state.lastScannedBlock.toString(), borrowerCount: state.borrowers.size, stale: failed };
}

function warmFeed(chainId: number): WarmFeed<FeedResult> {
  let w = WARM.get(chainId);
  if (!w) {
    w = createWarmFeed(() => buildFeed(chainId), REFRESH_MS);
    WARM.set(chainId, w);
  }
  return w;
}

// Re-reads per borrower: one at a time, and a repeat within the cooldown shares the earlier one.
const REFRESH_COOLDOWN_MS = 3_000;
const RECENT_REFRESH = new Map<string, { at: number; done: Promise<void> }>();

/** Re-read one known borrower now (after a liquidation) and patch its row into the warm list. */
async function refreshBorrower(chainId: number, borrower: string): Promise<void> {
  const w = warmFeed(chainId);
  await w.get(); // makes sure a list, the borrower set and the reserve metadata exist
  const b = borrower.toLowerCase();
  if (!STATE_BY_CHAIN.get(chainId)?.borrowers.has(b)) return;
  const key = `${chainId}:${b}`;
  const recent = RECENT_REFRESH.get(key);
  if (recent && Date.now() - recent.at < REFRESH_COOLDOWN_MS) return recent.done;
  const done = reread(chainId, w, b);
  RECENT_REFRESH.set(key, { at: Date.now(), done });
  return done;
}

async function reread(chainId: number, w: WarmFeed<FeedResult>, b: string): Promise<void> {
  const meta = RESERVES.get(chainId);
  if (!meta) return;
  const { rows, failed } = await readBorrowers(chainId, clientFor(chainId), meta, [b]);
  if (failed > 0) return; // a failed read leaves the row as it was
  const lastGood = LAST_GOOD.get(chainId);
  // Safe to run again on a newer list: a rebuild that read before the liquidation gets this patch too.
  w.update((feed) => {
    if (rows.length) lastGood?.set(b, rows[0]);
    else lastGood?.delete(b);
    return { ...feed, rows: [...feed.rows.filter((r) => r.borrower.toLowerCase() !== b), ...rows].sort((x, y) => x.hf - y.hf) };
  });
}

export async function loadAtRiskFeed(chainId: number, opts: { hfMax?: number; refresh?: string } = {}): Promise<{
  rows: AtRiskRow[];
  generatedAt: string;
  /** Seconds since the list was built, measured on the server, so the page never compares its own clock with the server's. */
  ageSeconds: number;
  scannedBlock: string;
  borrowerCount: number;
  stale: number;
}> {
  if (!isSupportedChain(chainId)) throw new Error(`Unsupported chainId ${chainId}`); // before any feed or timer exists
  const hfMax = Math.min(opts.hfMax ?? 1.05, HF_CEILING);
  if (opts.refresh) await refreshBorrower(chainId, opts.refresh);
  const { value, generatedAt } = await warmFeed(chainId).get();
  return {
    rows: value.rows.filter((r) => r.hf <= hfMax),
    generatedAt: new Date(generatedAt).toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - generatedAt) / 1000)),
    scannedBlock: value.scannedBlock,
    borrowerCount: value.borrowerCount,
    stale: value.stale,
  };
}
