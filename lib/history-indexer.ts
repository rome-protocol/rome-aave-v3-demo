// Per-user history feed for /history.
//
// One address-filtered getLogs per window (all event types at once), decoded
// locally and cached in memory per chain. The first scan walks from the pool's
// first log block in windows of at most 1,000,000 blocks (the Hadrian proxy
// limit, inclusive); later requests only read the blocks after the last scan.
// Concurrent requests share one in-flight scan. A user's history is filtered
// from the cache.
//
// Event args used for the user filter (Aave V3.6 IPool.sol):
//   Supply onBehalfOf · Withdraw user · Borrow onBehalfOf · Repay user
//   FlashLoan initiator (non-indexed) · LiquidationCall liquidator / user

import { createPublicClient, http, defineChain, parseAbiItem, decodeEventLog, type Address, type PublicClient } from "viem";
import { getAaveDeployment, getChain } from "./registry-config";
import { POOL_DEPLOY_BLOCK } from "./pool-deploy-block";

/** Hadrian serves address-filtered getLogs over at most this many blocks, inclusive. */
export const MAX_LOG_WINDOW = 1_000_000n;

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
  /** For LiquidationCall rows, "liquidator" or "liquidatee". */
  liqRole?: "liquidator" | "liquidatee";
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

const EVENTS = {
  Supply:    parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  Withdraw:  parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)"),
  Borrow:    parseAbiItem("event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"),
  Repay:     parseAbiItem("event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)"),
  FlashLoan: parseAbiItem("event FlashLoan(address indexed target, address initiator, address indexed asset, uint256 amount, uint8 interestRateMode, uint256 premium, uint16 indexed referralCode)"),
  LiquidationCall: parseAbiItem("event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)"),
} as const;

interface ReserveMeta {
  decimals: number;
  displaySymbol: string;
}

function _fmtDay(ts: number, now: number): string {
  const dayMs = 24 * 60 * 60 * 1000;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const eventDay = new Date(ts);
  eventDay.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - eventDay.getTime()) / dayMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  // "May 21" style
  return eventDay.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function _fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Split [from, to] (inclusive) into windows of at most `size` blocks. */
export function splitWindows(from: bigint, to: bigint, size: bigint = MAX_LOG_WINDOW): Array<[bigint, bigint]> {
  const out: Array<[bigint, bigint]> = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n > to ? to : start + size - 1n;
    out.push([start, end]);
  }
  return out;
}

export interface CachedLog {
  eventName: keyof typeof EVENTS;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: string;
}

export interface ScanState {
  logs: CachedLog[];
  /** Last block fully scanned; start - 1 before the first scan. */
  lastScannedBlock: bigint;
  inflight?: Promise<void>;
}

/**
 * Extend the cache up to `head`, one window at a time. Progress is kept after
 * each window, so a failed scan resumes where it stopped. Concurrent callers
 * share one in-flight scan (a caller that needs a newer head simply runs again).
 */
export async function extendScan(
  state: ScanState,
  head: bigint,
  fetchWindow: (from: bigint, to: bigint) => Promise<CachedLog[]>,
): Promise<void> {
  while (state.inflight) await state.inflight;
  if (state.lastScannedBlock >= head) return;
  const run = (async () => {
    for (const [from, to] of splitWindows(state.lastScannedBlock + 1n, head)) {
      state.logs.push(...(await fetchWindow(from, to)));
      state.lastScannedBlock = to;
    }
  })();
  state.inflight = run;
  try {
    await run;
  } finally {
    if (state.inflight === run) state.inflight = undefined;
  }
}

const EVENT_ABI = Object.values(EVENTS);
const STATE_BY_CHAIN = new Map<number, ScanState>();
const TS_BY_CHAIN = new Map<number, Map<bigint, number>>();

/** Last block the history cache has scanned (0 before the first scan). For /api/status. */
export function getHistoryLastScannedBlock(chainId: number): bigint {
  const s = STATE_BY_CHAIN.get(chainId);
  return s && s.lastScannedBlock >= POOL_DEPLOY_BLOCK ? s.lastScannedBlock : 0n;
}

async function _fetchWindow(client: PublicClient, pool: Address, from: bigint, to: bigint): Promise<CachedLog[]> {
  const raw = await client.getLogs({ address: pool, fromBlock: from, toBlock: to });
  const out: CachedLog[] = [];
  for (const log of raw) {
    try {
      const d = decodeEventLog({ abi: EVENT_ABI, data: log.data, topics: log.topics as any });
      out.push({
        eventName: d.eventName as CachedLog["eventName"],
        args: d.args as unknown as Record<string, unknown>,
        blockNumber: log.blockNumber as bigint,
        transactionHash: log.transactionHash as string,
      });
    } catch {
      // Not one of the six events we show (e.g. ReserveDataUpdated) — skip.
    }
  }
  return out;
}

export async function loadUserHistory(chainId: number, user: Address, opts: { limit?: number } = {}): Promise<{
  rows: HistoryRow[];
  generatedAt: string;
  scannedBlock: string;
}> {
  const dep = getAaveDeployment(chainId);
  if (!dep) throw new Error(`No Aave deployment for chain ${chainId}`);
  const client = clientFor(chainId);
  const currentBlock = await client.getBlockNumber();

  // Index reserves once.
  const reservesByAddr = new Map<string, ReserveMeta>();
  for (const r of dep.reserves) {
    reservesByAddr.set(r.underlying.toLowerCase(), {
      decimals: r.decimals,
      displaySymbol: r.displaySymbol,
    });
  }

  const userLower = user.toLowerCase();
  const pool = dep.pool as Address;

  let state = STATE_BY_CHAIN.get(chainId);
  if (!state) {
    state = { logs: [], lastScannedBlock: POOL_DEPLOY_BLOCK - 1n };
    STATE_BY_CHAIN.set(chainId, state);
  }
  await extendScan(state, currentBlock, (from, to) => _fetchWindow(client, pool, from, to));

  const isUser = (v: unknown) => typeof v === "string" && v.toLowerCase() === userLower;
  const byEvent = (name: CachedLog["eventName"], key: string) =>
    state!.logs.filter((l) => l.eventName === name && isUser(l.args[key]));
  const supplyLogs = byEvent("Supply", "onBehalfOf");
  const withdrawLogs = byEvent("Withdraw", "user");
  const borrowLogs = byEvent("Borrow", "onBehalfOf");
  const repayLogs = byEvent("Repay", "user");
  const flashLoanLogs = byEvent("FlashLoan", "initiator");
  const liqLogs = state.logs.filter(
    (l) => l.eventName === "LiquidationCall" && (isUser(l.args.liquidator) || isUser(l.args.user)),
  );

  const rows: HistoryRow[] = [];
  let blockTimestampCache = TS_BY_CHAIN.get(chainId);
  if (!blockTimestampCache) {
    blockTimestampCache = new Map<bigint, number>();
    TS_BY_CHAIN.set(chainId, blockTimestampCache);
  }

  async function _resolveTs(blockNumber: bigint): Promise<number> {
    const cached = blockTimestampCache!.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const ts = Number(block.timestamp) * 1000;
    blockTimestampCache!.set(blockNumber, ts);
    return ts;
  }

  const now = Date.now();

  const pushRow = (
    action: HistoryRow["action"],
    reserve: string,
    amountRaw: bigint,
    log: { blockNumber: bigint; transactionHash: string },
    liqRole?: HistoryRow["liqRole"],
  ): Promise<void> | void => {
    const meta = reservesByAddr.get(reserve.toLowerCase());
    if (!meta) return;
    const denom = 10 ** meta.decimals;
    const amount = Number(amountRaw) / denom;
    return _resolveTs(log.blockNumber).then((ts) => {
      rows.push({
        day: _fmtDay(ts, now),
        time: _fmtTime(ts),
        blockNumber: Number(log.blockNumber),
        timestamp: ts,
        action,
        amount,
        symbol: meta.displaySymbol,
        evmHash: log.transactionHash,
        ...(liqRole ? { liqRole } : {}),
      });
    });
  };

  // Collect all the async pushes and await them at the end so the rows
  // array is fully populated before we sort.
  const pending: Array<Promise<void> | void> = [];

  for (const log of supplyLogs as any[]) {
    pending.push(pushRow("Supply", log.args.reserve as string, log.args.amount as bigint, log));
  }
  for (const log of withdrawLogs as any[]) {
    pending.push(pushRow("Withdraw", log.args.reserve as string, log.args.amount as bigint, log));
  }
  for (const log of borrowLogs as any[]) {
    pending.push(pushRow("Borrow", log.args.reserve as string, log.args.amount as bigint, log));
  }
  for (const log of repayLogs as any[]) {
    pending.push(pushRow("Repay", log.args.reserve as string, log.args.amount as bigint, log));
  }
  // Optional-chain the indexed args. A malformed / ABI-drifted log would
  // otherwise throw `Cannot read toLowerCase of undefined` inside Promise.all
  // and 500 the whole /history response.
  for (const log of flashLoanLogs as any[]) {
    const initiator = (log.args?.initiator as string | undefined)?.toLowerCase();
    if (!initiator || initiator !== userLower) continue;
    pending.push(pushRow("FlashLoan", log.args.asset as string, log.args.amount as bigint, log));
  }
  for (const log of liqLogs as any[]) {
    const liquidator = (log.args?.liquidator as string | undefined)?.toLowerCase();
    const liquidatee = (log.args?.user as string | undefined)?.toLowerCase();
    if (!liquidator || !liquidatee) continue;
    if (liquidator === userLower) {
      pending.push(pushRow("LiquidationCall", log.args.debtAsset as string, log.args.debtToCover as bigint, log, "liquidator"));
    } else if (liquidatee === userLower) {
      pending.push(pushRow("LiquidationCall", log.args.debtAsset as string, log.args.debtToCover as bigint, log, "liquidatee"));
    }
  }

  await Promise.all(pending);

  // Most-recent first.
  rows.sort((a, b) => b.timestamp - a.timestamp);
  const limited = opts.limit ? rows.slice(0, opts.limit) : rows;

  return {
    rows: limited,
    generatedAt: new Date(now).toISOString(),
    scannedBlock: currentBlock.toString(),
  };
}
