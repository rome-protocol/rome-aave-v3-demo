// Per-user history feed for /history.
//
// Strategy: for each Aave V3 event we care about (Supply, Withdraw, Borrow,
// Repay, FlashLoan, LiquidationCall), getLogs with the user filtered on
// whichever topic actually carries them. Decoded entries flow into a
// unified row shape that data.jsx's HISTORY array consumes.
//
// Topic indexing (Aave V3.6 IPool.sol):
//   Supply          — reserve (topic 1), onBehalfOf (topic 2). `user`=msg.sender, non-indexed
//   Withdraw        — reserve (1), user (2), to (3)
//   Borrow          — reserve (1), onBehalfOf (2), referralCode (3). `user` non-indexed
//   Repay           — reserve (1), user (2), repayer (3)
//   FlashLoan       — target (1), asset (2), referralCode (3). `initiator` non-indexed
//   LiquidationCall — collateralAsset (1), debtAsset (2), user (3)
//
// For Supply/Borrow → user = topic 2 (onBehalfOf, who carries the position).
// For Withdraw/Repay → user = topic 2 (the position owner). repayer/to may
//   be a delegate; we don't surface those distinctions in v1.
// For FlashLoan → initiator is non-indexed. Filter post-decode.
// For LiquidationCall → topic 3 is the borrower (liquidatee); for "as
//   liquidator" rows we filter the non-indexed `liquidator` field post-decode.
//
// No caching — history is per-user, low-volume, called on /history mount.

import { createPublicClient, http, defineChain, parseAbiItem, type Address, type PublicClient } from "viem";
import { getAaveDeployment, getChain } from "./registry-config";

const BLOCK_SCAN_CHUNK = 5_000n;

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

async function _scanLogs(
  client: PublicClient,
  pool: Address,
  event: typeof EVENTS[keyof typeof EVENTS],
  fromBlock: bigint,
  toBlock: bigint,
  args?: Record<string, unknown>,
) {
  const out: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  for (let start = fromBlock; start <= toBlock; start += BLOCK_SCAN_CHUNK) {
    const end = start + BLOCK_SCAN_CHUNK - 1n > toBlock ? toBlock : start + BLOCK_SCAN_CHUNK - 1n;
    const logs = await client.getLogs({
      address: pool,
      event: event as any,
      fromBlock: start,
      toBlock: end,
      ...(args ? { args } : {}),
    } as any);
    out.push(...logs);
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
  const FROM = 0n;

  // Run all six scans in parallel.
  const [supplyLogs, withdrawLogs, borrowLogs, repayLogs, flashLoanLogs, liqLogs] = await Promise.all([
    _scanLogs(client, pool, EVENTS.Supply,    FROM, currentBlock, { onBehalfOf: user }),
    _scanLogs(client, pool, EVENTS.Withdraw,  FROM, currentBlock, { user }),
    _scanLogs(client, pool, EVENTS.Borrow,    FROM, currentBlock, { onBehalfOf: user }),
    _scanLogs(client, pool, EVENTS.Repay,     FROM, currentBlock, { user }),
    // FlashLoan: initiator is non-indexed. Scan all + filter in memory.
    _scanLogs(client, pool, EVENTS.FlashLoan, FROM, currentBlock),
    // LiquidationCall: scan all + match either liquidator (non-indexed) or
    // user (topic 3, the liquidatee). Could narrow with two queries but
    // volume's low.
    _scanLogs(client, pool, EVENTS.LiquidationCall, FROM, currentBlock),
  ]);

  const rows: HistoryRow[] = [];
  const blockTimestampCache = new Map<bigint, number>();

  async function _resolveTs(blockNumber: bigint): Promise<number> {
    const cached = blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const ts = Number(block.timestamp) * 1000;
    blockTimestampCache.set(blockNumber, ts);
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
