// Market overview with the EVM / Solana split, precomputed in memory.
//
// Every refresh (~30 s, background): scan new Supply/Borrow events (address-filtered getLogs, 1M-block
// windows, from the pool's deploy block) for holder addresses, classify each new address once by the
// signature of one of its own transactions (cached forever), read every holder's balances through
// Multicall3, and sum per side (market-split.ts). Pages read the last snapshot from memory.

import { createPublicClient, http, defineChain, parseAbiItem, type Address, type PublicClient } from "viem";
import { getAaveDeployment, getChain } from "./registry-config";
import { POOL_DEPLOY_BLOCK } from "./pool-deploy-block";
import { UiPoolDataProviderV3Abi } from "./abi";
import { blockWindows } from "./at-risk-refresh";
import { buildOverview, classifySignature, foldHolders, splitIsFresh, type MarketOverview, type Position, type ReserveInput, type Side } from "./market-split";

const SCAN_WINDOW = 1_000_000n;
const REFRESH_MS = 30_000;
const CLASSIFY_CONCURRENCY = 4;
const MULTICALL_CHUNK = 20;
const RAY = 10n ** 27n;
// Multicall3 on Hadrian (registry contracts.json).
const MULTICALL3 = "0xb7180d3c46632b582b99d9af3daae394fab9ae4c" as const;

const SUPPLY_EVENT = parseAbiItem(
  "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
);
const BORROW_EVENT = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

interface State {
  lastScannedBlock: bigint;
  /** holder -> hash of one tx the holder sent itself (undefined: only ever acted for by someone else) */
  holders: Map<string, string | undefined>;
  side: Map<string, "evm" | "solana">; // classified once, never changes
  lastGood: Map<string, Position["reserves"]>; // last good balances, kept across a failed read
  snapshot: MarketOverview | null;
  /** ms time of the last round where every balance read succeeded; the split is served only while this is fresh */
  balancesOkAt: number;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | null;
}

const STATES = new Map<number, State>();

function stateFor(chainId: number): State {
  let s = STATES.get(chainId);
  if (!s) {
    s = { lastScannedBlock: POOL_DEPLOY_BLOCK - 1n, holders: new Map(), side: new Map(), lastGood: new Map(), snapshot: null, balancesOkAt: 0, inFlight: null, timer: null };
    STATES.set(chainId, s);
  }
  return s;
}

function clientFor(chainId: number): PublicClient {
  const c = getChain(chainId);
  if (!c) throw new Error(`Unsupported chainId ${chainId}`);
  const chain = defineChain({
    id: c.chainId,
    name: c.name,
    nativeCurrency: c.nativeCurrency,
    rpcUrls: { default: { http: [c.rpcUrl] } },
    contracts: { multicall3: { address: MULTICALL3 } },
  });
  return createPublicClient({ chain, transport: http(c.rpcUrl) }) as PublicClient;
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

async function scanHolders(client: PublicClient, pool_: Address, s: State) {
  const head = await client.getBlockNumber();
  for (const [from, to] of blockWindows(s.lastScannedBlock + 1n, head, SCAN_WINDOW)) {
    const logs = await client.getLogs({ address: pool_, events: [SUPPLY_EVENT, BORROW_EVENT], fromBlock: from, toBlock: to });
    foldHolders(logs, s.holders);
    s.lastScannedBlock = to; // progress survives a later failure
  }
}

async function classifyNew(client: PublicClient, s: State) {
  const todo = [...s.holders].filter(([h, tx]) => tx && !s.side.has(h));
  await pool(todo, CLASSIFY_CONCURRENCY, async ([h, tx]) => {
    try {
      const t = (await client.request({ method: "eth_getTransactionByHash", params: [tx as `0x${string}`] })) as { r?: string; s?: string } | null;
      const side = t ? classifySignature(t) : undefined;
      if (side) s.side.set(h, side);
    } catch (e) {
      console.warn(`[market-overview] classify ${h} failed, retrying next round:`, e instanceof Error ? e.message : e);
    }
  });
}

async function readBalances(client: PublicClient, s: State, ui: Address, provider: Address): Promise<boolean> {
  let ok = true;
  const addrs = [...s.holders.keys()];
  for (let i = 0; i < addrs.length; i += MULTICALL_CHUNK) {
    const chunk = addrs.slice(i, i + MULTICALL_CHUNK);
    try {
      const res = await client.multicall({
        allowFailure: true,
        batchSize: 1_000_000,
        contracts: chunk.map((u) => ({ address: ui, abi: UiPoolDataProviderV3Abi, functionName: "getUserReservesData", args: [provider, u as Address] })),
      });
      res.forEach((r, k) => {
        if (r.status !== "success") { ok = false; return; }
        const [rows] = r.result as unknown as [Array<{ underlyingAsset: string; scaledATokenBalance: bigint; scaledVariableDebt: bigint }>, number];
        s.lastGood.set(chunk[k], rows.map((x) => ({ asset: x.underlyingAsset, scaledA: x.scaledATokenBalance, scaledDebt: x.scaledVariableDebt })));
      });
    } catch (e) {
      ok = false;
      console.warn("[market-overview] balance batch failed, keeping last good:", e instanceof Error ? e.message : e);
    }
  }
  return ok;
}

async function refresh(chainId: number): Promise<void> {
  const dep = getAaveDeployment(chainId);
  if (!dep?.uiPoolDataProviderV3) throw new Error(`No Aave deployment for chain ${chainId}`);
  const s = stateFor(chainId);
  const client = clientFor(chainId);
  const ui = dep.uiPoolDataProviderV3 as Address;
  const provider = dep.addressesProvider as Address;

  try {
    await scanHolders(client, dep.pool as Address, s);
  } catch (e) {
    console.warn("[market-overview] holder scan failed, using the known set:", e instanceof Error ? e.message : e);
  }
  await classifyNew(client, s);
  const balancesOk = await readBalances(client, s, ui, provider);

  const [data, base] = (await client.readContract({ address: ui, abi: UiPoolDataProviderV3Abi, functionName: "getReservesData", args: [provider] })) as unknown as [
    Array<Record<string, any>>,
    { marketReferenceCurrencyUnit: bigint },
  ];
  const refUnit = Number(base.marketReferenceCurrencyUnit ?? 100_000_000n);
  const reserves: ReserveInput[] = data.map((r) => {
    const entry = dep.reserves.find((d) => d.underlying.toLowerCase() === (r.underlyingAsset as string).toLowerCase());
    // Same totals as buildDemoConfig, so the sides add up to what the page shows.
    const totalDebtRaw = ((r.totalScaledVariableDebt as bigint) * (r.variableBorrowIndex as bigint)) / RAY;
    return {
      asset: r.underlyingAsset as string,
      symbol: entry?.displaySymbol ?? r.symbol ?? "?",
      decimals: Number(r.decimals),
      priceUsd: Number(r.priceInMarketReferenceCurrency) / refUnit,
      liquidityIndex: r.liquidityIndex as bigint,
      variableBorrowIndex: r.variableBorrowIndex as bigint,
      totalSupplyRaw: (r.availableLiquidity as bigint) + totalDebtRaw,
      totalDebtRaw,
    };
  });

  const positions: Position[] = [...s.holders.keys()].flatMap((h) => {
    const rows = s.lastGood.get(h);
    return rows ? [{ side: (s.side.get(h) ?? "other") as Side, reserves: rows }] : [];
  });
  s.snapshot = buildOverview(reserves, positions, { scannedBlock: s.lastScannedBlock });
  if (balancesOk) s.balancesOkAt = Date.now();
}

function kick(chainId: number): Promise<void> {
  const s = stateFor(chainId);
  if (!s.inFlight) {
    s.inFlight = refresh(chainId)
      .catch((e) => console.warn("[market-overview] refresh failed:", e instanceof Error ? e.message : e))
      .finally(() => { s.inFlight = null; });
  }
  return s.inFlight;
}

export const isSupportedChain = (chainId: number) => !!getChain(chainId) && !!getAaveDeployment(chainId)?.uiPoolDataProviderV3;

/** The last snapshot (null until the first build finishes, and while its balances are older than 2 minutes). The first call starts the ~30 s background refresh. */
export function getMarketOverview(chainId: number): MarketOverview | null {
  if (!isSupportedChain(chainId)) return null; // no state, no timer for chains we do not serve
  const s = stateFor(chainId);
  if (!s.timer) {
    s.timer = setInterval(() => void kick(chainId), REFRESH_MS);
    s.timer.unref?.();
    void kick(chainId);
  }
  return s.snapshot && splitIsFresh(s.balancesOkAt, Date.now()) ? s.snapshot : null;
}
