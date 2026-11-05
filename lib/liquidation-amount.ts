// Liquidation amount rules, from Aave v3.6 LiquidationLogic.sol:
//  - full debt may be repaid when the reserve's debt or collateral is under $2,000
//    (MIN_BASE_MAX_CLOSE_FACTOR_THRESHOLD) or HF <= 0.95 (CLOSE_FACTOR_HF_THRESHOLD); otherwise
//    at most half the borrower's TOTAL debt (DEFAULT_LIQUIDATION_CLOSE_FACTOR);
//  - a partial liquidation must leave at least $1,000 (MIN_LEFTOVER_BASE) of both debt and
//    collateral, or it reverts with MustNotLeaveDust.

export const MIN_CLOSE_FACTOR_USD = 2000;
export const MIN_LEFTOVER_USD = 1000;
export const CLOSE_FACTOR_HF = 0.95;
/** Headroom on a full close so interest accrued since the feed was read cannot leave dust. Aave caps the amount at the real debt. */
const FULL_CLOSE_HEADROOM = 1.01;

export interface LiquidationPosition {
  hf: number;
  /** Borrower's total debt, all assets. */
  totalDebtUsd: number;
  /** Borrower's debt in the asset being repaid. */
  debtAssetUsd: number;
  /** Borrower's collateral in the asset being seized. */
  collatUsd: number;
  /** Collateral reserve's liquidation bonus as a fraction (0.05 = 5%). */
  bonusPct: number;
}

/** Margin over the $1,000 leftover so rounding and price moves cannot tip a partial repay into dust. */
const LEFTOVER_MARGIN_USD = MIN_LEFTOVER_USD * 1.005;

/**
 * USD of debt the modal should pre-fill. `full` marks a full close of the asset's debt.
 */
export function defaultDebtUsd(p: LiquidationPosition): { usd: number; full: boolean } {
  const canCloseFull =
    p.hf <= CLOSE_FACTOR_HF || p.debtAssetUsd < MIN_CLOSE_FACTOR_USD || p.collatUsd < MIN_CLOSE_FACTOR_USD;
  const half = p.totalDebtUsd / 2;
  // Aave allows the whole asset debt when the close factor does not apply or half the total covers it.
  if (canCloseFull || p.debtAssetUsd <= half) return { usd: p.debtAssetUsd, full: true };
  // Partial repay: Aave caps it at half the total debt, and both the debt and the collateral left
  // must stay at or above $1,000, so lower the amount rather than raise it past the cap. Debt and
  // collateral are both at least $2,000 here, so the result is always positive.
  const usd = Math.min(half, p.debtAssetUsd - LEFTOVER_MARGIN_USD, (p.collatUsd - LEFTOVER_MARGIN_USD) / (1 + p.bonusPct));
  return { usd, full: false };
}

/** Token amount string in the token's own decimals (no scientific notation, no trailing zeros). */
export function toTokenString(usd: number, priceUsd: number, decimals: number, full: boolean): string {
  if (!(priceUsd > 0) || !(usd > 0)) return "0";
  const tokens = usd / priceUsd;
  const p = Math.min(decimals, 8);
  const scale = 10 ** p;
  // Full close rounds up (plus headroom); a partial close rounds down so it stays under the close factor.
  const n = full ? Math.ceil(tokens * FULL_CLOSE_HEADROOM * scale) / scale : Math.floor(tokens * scale) / scale;
  const s = n.toFixed(p);
  return s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
}

/** "You receive" preview: collateral for `repayUsd` of debt plus bonus, never more than the borrower holds. */
export function previewCollateral(repayUsd: number, bonusPct: number, collatUsd: number, collatPriceUsd: number) {
  const outUsd = Math.min(repayUsd * (1 + bonusPct), Math.max(collatUsd, 0));
  const bonusUsd = outUsd - outUsd / (1 + bonusPct);
  return { outUsd, bonusUsd, tokens: collatPriceUsd > 0 ? outUsd / collatPriceUsd : 0, capped: repayUsd * (1 + bonusPct) > collatUsd };
}
