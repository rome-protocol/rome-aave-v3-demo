// EVM / Solana split of the market. Pure helpers, no chain reads (see market-overview.ts for those).
//
// A transaction sent from a Solana wallet through Rome carries no EVM signature (r = s = 0); an EVM
// wallet's transaction always has a real one. An address never changes side, so it is classified once.
// Each side's balances are summed per reserve; whatever the market total holds beyond the classified
// addresses (aTokens moved by transfer, accrued protocol fees) is reported as "other".

const RAY = 10n ** 27n;

export type Side = "evm" | "solana" | "other";
export type BySide<T> = Record<Side, T>;

/**
 * Solana-wallet tx: r and s are both present and zero (Rome returns an explicit 0x0). (v alone proves
 * nothing: typed EVM txs use 0/1.) A missing r or s is no evidence either way: undefined, retried later.
 */
export function classifySignature(tx: { r?: string | null; s?: string | null }): "evm" | "solana" | undefined {
  if (tx.r == null || tx.s == null) return undefined;
  return BigInt(tx.r) === 0n && BigInt(tx.s) === 0n ? "solana" : "evm";
}

/**
 * Fold Supply/Borrow logs into holders: onBehalfOf -> hash of a tx the holder sent itself
 * (user === onBehalfOf; the first such tx wins), or undefined while it has only been acted for.
 */
export function foldHolders(
  logs: Array<{ args: { user?: string; onBehalfOf?: string }; transactionHash: string }>,
  holders: Map<string, string | undefined>,
): void {
  for (const log of logs) {
    if (!log.args.onBehalfOf) continue;
    const holder = log.args.onBehalfOf.toLowerCase();
    const own = log.args.user?.toLowerCase() === holder ? log.transactionHash : undefined;
    holders.set(holder, holders.get(holder) ?? own);
  }
}

export interface ReserveInput {
  asset: string;
  symbol: string;
  decimals: number;
  priceUsd: number;
  liquidityIndex: bigint;
  variableBorrowIndex: bigint;
  /** Same figures the page shows: supplied = available liquidity + debt; borrowed = scaled debt x index. */
  totalSupplyRaw: bigint;
  totalDebtRaw: bigint;
}

export interface Position {
  side: Side;
  reserves: Array<{ asset: string; scaledA: bigint; scaledDebt: bigint }>;
}

export interface ReserveSplit {
  supplied: BySide<bigint>;
  borrowed: BySide<bigint>;
}

/** Per reserve: sum each side's positions; "other" = market total minus the classified sides (never below 0). */
export function splitReserves(reserves: ReserveInput[], positions: Position[]): ReserveSplit[] {
  return reserves.map((r) => {
    const supplied: BySide<bigint> = { evm: 0n, solana: 0n, other: 0n };
    const borrowed: BySide<bigint> = { evm: 0n, solana: 0n, other: 0n };
    const asset = r.asset.toLowerCase();
    for (const p of positions) {
      if (p.side === "other") continue; // lands in the remainder below
      for (const x of p.reserves) {
        if (x.asset.toLowerCase() !== asset) continue;
        supplied[p.side] += (x.scaledA * r.liquidityIndex) / RAY;
        borrowed[p.side] += (x.scaledDebt * r.variableBorrowIndex) / RAY;
      }
    }
    const rest = (total: bigint, s: BySide<bigint>) => (total > s.evm + s.solana ? total - s.evm - s.solana : 0n);
    supplied.other = rest(r.totalSupplyRaw, supplied);
    borrowed.other = rest(r.totalDebtRaw, borrowed);
    return { supplied, borrowed };
  });
}

export interface OverviewReserve {
  symbol: string;
  priceUsd: number;
  utilization: number;
  supplied: BySide<number>; // tokens
  borrowed: BySide<number>;
  suppliedUsd: BySide<number>;
  borrowedUsd: BySide<number>;
}

export interface MarketOverview {
  generatedAt: string;
  scannedBlock: string;
  addresses: BySide<number>;
  /** USD at the oracle's live prices. Available per side = its supplied minus its borrowed, floored at 0. */
  headline: { sizeUsd: BySide<number>; borrowsUsd: BySide<number>; availableUsd: BySide<number> };
  reserves: OverviewReserve[];
}

const SIDES: Side[] = ["evm", "solana", "other"];
const zero = (): BySide<number> => ({ evm: 0, solana: 0, other: 0 });
export const sumSides = (s: BySide<number>) => s.evm + s.solana + s.other;

export function buildOverview(
  reserves: ReserveInput[],
  positions: Position[],
  meta: { scannedBlock: bigint; now?: Date },
): MarketOverview {
  const splits = splitReserves(reserves, positions);
  const sizeUsd = zero();
  const borrowsUsd = zero();
  const rows = reserves.map((r, i): OverviewReserve => {
    const denom = 10 ** r.decimals;
    const supplied = zero(), borrowed = zero(), suppliedUsd = zero(), borrowedUsd = zero();
    for (const s of SIDES) {
      supplied[s] = Number(splits[i].supplied[s]) / denom;
      borrowed[s] = Number(splits[i].borrowed[s]) / denom;
      suppliedUsd[s] = supplied[s] * r.priceUsd;
      borrowedUsd[s] = borrowed[s] * r.priceUsd;
      sizeUsd[s] += suppliedUsd[s];
      borrowsUsd[s] += borrowedUsd[s];
    }
    const sup = sumSides(supplied);
    return {
      symbol: r.symbol, priceUsd: r.priceUsd,
      utilization: sup > 0 ? sumSides(borrowed) / sup : 0,
      supplied, borrowed, suppliedUsd, borrowedUsd,
    };
  });
  const addresses = zero();
  for (const p of positions) addresses[p.side]++;
  const availableUsd = zero();
  for (const s of ["evm", "solana"] as const) availableUsd[s] = Math.max(0, sizeUsd[s] - borrowsUsd[s]);
  availableUsd.other = Math.max(0, sumSides(sizeUsd) - sumSides(borrowsUsd) - availableUsd.evm - availableUsd.solana);
  return {
    generatedAt: (meta.now ?? new Date()).toISOString(),
    scannedBlock: meta.scannedBlock.toString(),
    addresses,
    headline: { sizeUsd, borrowsUsd, availableUsd },
    reserves: rows,
  };
}

/** The per-side split is only as good as its last fully successful balance read. */
export const splitIsFresh = (balancesOkAtMs: number, nowMs: number, maxAgeMs = 120_000) => balancesOkAtMs > 0 && nowMs - balancesOkAtMs < maxAgeMs;
