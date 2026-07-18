// Display formatters — currency, percentages, addresses, health-factor.

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
  pct(n: number | null | undefined, dp = 2): string {
    if (n == null || isNaN(n)) return "—";
    return `${(n * 100).toFixed(dp)}%`;
  },
  hf(n: number | null | undefined): string {
    if (n === Infinity || n == null) return "∞";
    if (n > 999) return "999+";
    return n.toFixed(2);
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
