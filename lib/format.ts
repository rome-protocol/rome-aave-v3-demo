// Display formatters — currency, percentages, addresses, health-factor.
// Money, amounts and shares follow the Rome app UI guide, section 5 (the DEX's app/lib/format.ts): fmtUsd, fmtAmount, fmtShare.

/** Money: two decimals under $1,000 (a non-zero value under one cent is "<$0.01"), one decimal with K from $1,000, two with M from $999,950. Not a number is "—". */
export function fmtUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 999_950) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  if (abs > 0 && abs < 0.01) return `${sign}<$0.01`;
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A token amount: at most 2 decimals from 1,000, 4 from 1, 6 below 1 (trailing zeros dropped); M from a million.
 * Dust never reads as 0: a non-zero amount under 0.000001 is "<0.000001".
 */
export function fmtAmount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (abs > 0 && abs < 0.000001) return `${v < 0 ? "-" : ""}<0.000001`;
  return v.toLocaleString("en-US", { maximumFractionDigits: abs >= 1000 ? 2 : abs >= 1 ? 4 : 6 });
}

/** A share in percent (12.3456 is 12.35%): two decimals, and a tiny share is never "0.00%". */
export function fmtShare(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return "0%";
  return pct < 0.01 ? "<0.01%" : `${pct.toFixed(2)}%`;
}

/** An oracle price, never compacted to K: two decimals from $1, up to four below $1 (a stablecoin's $0.9999 stays visible). */
export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v === 0) return "$0.00";
  if (Math.abs(v) >= 1) return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (Math.abs(v) < 0.0001) return "<$0.0001";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export const fmt = {
  usd(n: number | null | undefined, opts: { compact?: boolean; dp?: number } = {}): string {
    if (n == null || isNaN(n)) return "—";
    const { compact = false, dp = 2 } = opts;
    if (compact && Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (compact && Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
  },
  num(n: number | null | undefined, dp = 4): string {
    if (n == null || isNaN(n)) return "—";
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
  },
  /** Token amount: whole-ish when large, 4 decimals when small, "<0.0001" when tiny (never a misleading "0"). */
  amount(n: number | null | undefined): string {
    if (n == null || isNaN(n)) return "—";
    if (n === 0) return "0";
    const a = Math.abs(n);
    if (a < 0.0001) return n < 0 ? "-<0.0001" : "<0.0001";
    return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: a >= 100 ? 2 : 4 });
  },
  pct(n: number | null | undefined, dp = 2): string {
    if (n == null || isNaN(n)) return "—";
    const out = (n * 100).toFixed(dp);
    if (n > 0 && Number(out) === 0) return `<${(10 ** -dp).toFixed(dp)}%`;
    return `${out}%`;
  },
  /** Supply/borrow cap: 0 means the reserve has no cap. */
  cap(tokens: number, priceUsd: number): string {
    return tokens > 0 ? fmtUsd(tokens * priceUsd) : "No cap";
  },
  hf(n: number | null | undefined, dp = 2): string {
    if (n === Infinity || n == null) return "∞";
    if (n > 999) return "999+";
    return n.toFixed(dp);
  },
  addr(a: string | null | undefined, head = 6, tail = 4): string {
    if (!a) return "";
    if (a.length <= head + tail + 1) return a;
    return `${a.slice(0, head)}…${a.slice(-tail)}`;
  },
};

// Health-factor tier mapping. Used to color the HF pill + dashboard hero
// + any spot the design surfaces HF state.

// Compute the aggregates a Page needs (net worth, HF, etc.) from per-
// reserve positions + a `Reserve[]` index. The server's getUserAccountData
// is canonical when available — use those values when present and fall
// back to this only for skeleton renders.
import type { Reserve, UserPosition, ComputedAggregates } from "./types";

export function computeUserAggregates(
  positions: Record<string, UserPosition>,
  reservesBySymbol: Record<string, Reserve>,
): ComputedAggregates {
  let suppliedUsd = 0;
  let debtUsd = 0;
  let collateralUsd = 0;
  for (const sym of Object.keys(positions)) {
    const r = reservesBySymbol[sym];
    if (!r) continue;
    const p = positions[sym];
    suppliedUsd += p.suppliedBalance * r.priceUsd;
    debtUsd += p.debtBalance * r.priceUsd;
    if (p.isCollateral) collateralUsd += p.suppliedBalance * r.priceUsd * r.liqThreshold;
  }
  const netWorth = suppliedUsd - debtUsd;
  const hf = debtUsd > 0 ? collateralUsd / debtUsd : Infinity;

  let supplyRateAcc = 0;
  let borrowRateAcc = 0;
  for (const sym of Object.keys(positions)) {
    const r = reservesBySymbol[sym];
    if (!r) continue;
    const p = positions[sym];
    supplyRateAcc += p.suppliedBalance * r.priceUsd * r.supplyApy;
    borrowRateAcc += p.debtBalance * r.priceUsd * r.borrowApy;
  }
  const netSupplyApy = suppliedUsd > 0 ? supplyRateAcc / suppliedUsd : 0;
  const netBorrowApy = debtUsd > 0 ? borrowRateAcc / debtUsd : 0;
  const netApy = netWorth > 0 ? (supplyRateAcc - borrowRateAcc) / netWorth : 0;

  let totalBorrowPower = 0;
  for (const sym of Object.keys(positions)) {
    const r = reservesBySymbol[sym];
    if (!r) continue;
    const p = positions[sym];
    if (p.isCollateral) totalBorrowPower += p.suppliedBalance * r.priceUsd * r.ltv;
  }
  const ltvPct = totalBorrowPower > 0 ? Math.min(debtUsd / totalBorrowPower, 1) : 0;
  return { suppliedUsd, debtUsd, collateralUsd, netWorth, hf, netSupplyApy, netBorrowApy, netApy, ltvPct };
}
