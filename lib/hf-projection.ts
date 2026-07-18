// Health-factor projection. Used by ActionModal's TransactionOverview to
// show "HF: 2.34 → 1.62" — i.e. what the user's HF will be AFTER the
// pending supply / withdraw / borrow / repay lands.
//
// The math is the same one Pool.getUserAccountData runs on-chain:
//
//   weightedCollateral = sum_i (supplied_i × price_i × liqThreshold_i)   // for enabled-collat reserves
//   totalDebt          = sum_i (debt_i × price_i)
//   HF                 = weightedCollateral / totalDebt
//
// We don't have per-reserve weighted contributions in /api/user-data —
// we have the aggregate currentLiquidationThreshold = weightedCollateral
// / totalCollateral. That lets us reconstruct `weightedCollateral`
// without re-summing each reserve, and then apply the action delta on
// top.
//
// Per-action deltas:
//   supply   → collat += ΔUsd; weighted += ΔUsd × assetLT (if asset will be enabled as collateral)
//   withdraw → collat -= ΔUsd; weighted -= ΔUsd × assetLT (if asset is currently enabled)
//   borrow   → debt   += ΔUsd
//   repay    → debt   -= ΔUsd (floored at 0; protocol clamps too via MAX)

import type { ActionMode } from "@/hooks/useAaveAction";
import type { Reserve, UserPosition, UserAggregate } from "./types";

export interface HfProjectionInput {
  mode: ActionMode;
  amountUsd: number;             // ΔUsd
  reserve: Reserve;              // asset being acted on (for LT + canBeCollateral)
  position: UserPosition | undefined;  // user's current position on this asset
  aggregate: UserAggregate | undefined;
}

export interface HfProjection {
  /** Current HF (Infinity if no debt). */
  before: number;
  /** Projected HF after the action lands (Infinity if no debt post-action). */
  after: number;
  /** True when the user has no debt either before AND after — nothing to show. */
  bothInfinite: boolean;
}

export function projectHealthFactor({
  mode,
  amountUsd,
  reserve,
  position,
  aggregate,
}: HfProjectionInput): HfProjection | null {
  if (!aggregate) return null;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    // No delta to project. Return current HF unchanged so the modal can
    // still surface it if it wants.
    return {
      before: aggregate.healthFactor,
      after: aggregate.healthFactor,
      bothInfinite: aggregate.totalDebtUsd === 0,
    };
  }

  const totalCollatBefore = aggregate.totalCollateralUsd;
  const totalDebtBefore = aggregate.totalDebtUsd;
  const avgLtBefore = aggregate.currentLiquidationThreshold;
  const weightedBefore = totalCollatBefore * avgLtBefore;

  const assetLt = reserve.liqThreshold;
  const userHasItAsCollat = position?.isCollateral ?? false;

  let newCollat = totalCollatBefore;
  let newWeighted = weightedBefore;
  let newDebt = totalDebtBefore;

  switch (mode) {
    case "supply": {
      // Pool defaults usageAsCollateralEnabled = true on first supply
      // when the reserve allows collateral. Subsequent supplies inherit
      // the user's existing toggle.
      const willBeCollat = position
        ? userHasItAsCollat
        : reserve.canBeCollateral;
      newCollat = totalCollatBefore + amountUsd;
      newWeighted = willBeCollat
        ? weightedBefore + amountUsd * assetLt
        : weightedBefore;
      break;
    }
    case "withdraw": {
      const delta = Math.min(amountUsd, totalCollatBefore);
      newCollat = totalCollatBefore - delta;
      newWeighted = userHasItAsCollat
        ? Math.max(0, weightedBefore - delta * assetLt)
        : weightedBefore;
      break;
    }
    case "borrow": {
      newDebt = totalDebtBefore + amountUsd;
      break;
    }
    case "repay": {
      newDebt = Math.max(0, totalDebtBefore - amountUsd);
      break;
    }
  }

  const before = totalDebtBefore > 0 ? weightedBefore / totalDebtBefore : Infinity;
  const after = newDebt > 0 ? newWeighted / newDebt : Infinity;
  return {
    before,
    after,
    bothInfinite: before === Infinity && after === Infinity,
  };
}
