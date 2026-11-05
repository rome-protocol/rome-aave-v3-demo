// A borrow (and a withdraw while in debt) with too many collateral assets
// enabled is refused on Rome (one Solana transaction holds a limited number of
// accounts). With the Rome price oracle a 3-asset borrow fits (58 accounts);
// a 4th asset is unmeasured. Raise or remove the limit here; nothing else
// hardcodes it.
import type { ActionMode } from "@/hooks/useAaveAction";
import type { UserPosition } from "@/lib/types";

export const MAX_COLLATERAL_ASSETS_FOR_BORROW = 3;

/** Reserves the user has supplied and switched on as collateral. */
export function countCollateralAssets(
  positions: Record<string, UserPosition> | undefined,
): number {
  if (!positions) return 0;
  return Object.values(positions).filter((p) => p.isCollateral && p.suppliedBalance > 0).length;
}

export function hasAnyDebt(positions: Record<string, UserPosition> | undefined): boolean {
  if (!positions) return false;
  return Object.values(positions).some((p) => p.debtBalance > 0);
}

export interface CollateralLimitResult {
  blocked: boolean;
  message?: string;
}

export function checkCollateralLimit(args: {
  mode: ActionMode;
  positions: Record<string, UserPosition> | undefined;
  max?: number;
}): CollateralLimitResult {
  const max = args.max ?? MAX_COLLATERAL_ASSETS_FOR_BORROW;
  if (countCollateralAssets(args.positions) <= max) return { blocked: false };
  if (args.mode === "borrow") {
    return {
      blocked: true,
      message: `Borrowing works with up to ${max} collateral assets. Turn one off on the dashboard to borrow.`,
    };
  }
  if (args.mode === "withdraw" && hasAnyDebt(args.positions)) {
    return {
      blocked: true,
      message: `Withdrawing with debt works with up to ${max} collateral assets. Turn one off on the dashboard to withdraw.`,
    };
  }
  return { blocked: false };
}
