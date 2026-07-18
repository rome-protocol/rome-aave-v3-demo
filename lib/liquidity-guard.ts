// Pre-submit safety guards for all four Pool actions. Aave V3 reverts a
// predictable set of conditions (insufficient balance, exhausted pool
// liquidity, supply/borrow caps, frozen reserves, health-factor violations)
// with cryptic custom-error selectors. Catching them here — before the user
// signs anything — turns a confusing wallet revert into an actionable message.
//
// All comparisons are human-decimal Numbers (matching /api/aave-config +
// /api/user-data, which already format to human units). For Hadrian's
// 6/8/9/18-decimal tokens this stays inside Number precision for demo-sized
// amounts; the epsilon slack absorbs float dust on equality checks.

import type { ActionMode } from "@/hooks/useAaveAction";

export interface GuardResult {
  ok: boolean;
  message?: string;
}

export interface ActionGuardArgs {
  mode: ActionMode;
  amountHuman: string;
  symbol: string;
  decimals: number;
  priceUsd?: number;
  /** Human-unit balances for the connected user. Omit any you can't supply. */
  walletBalance?: number;
  suppliedBalance?: number;
  debtBalance?: number;
  /** Pool cash available to withdraw/borrow (aToken.totalSupply − debt). */
  availableLiquidity?: number;
  /** User's remaining borrow power in USD. */
  availableBorrowsUsd?: number;
  /** Reserve totals + flags (from /api/aave-config). */
  totalSupply?: number;
  supplyCap?: number; // 0 = uncapped
  frozen?: boolean;
  canBeBorrowed?: boolean;
  /** Projected post-action HF (Infinity if no debt after). Caller computes via projectHealthFactor. */
  projectedHfAfter?: number;
}

const EPS = 1e-9;
const ok: GuardResult = { ok: true };
const fail = (message: string): GuardResult => ({ ok: false, message });

export function checkActionSafety(a: ActionGuardArgs): GuardResult {
  const amount = Number(a.amountHuman);
  // Empty/zero/NaN is handled by the submit-disabled gate, not a warning.
  if (!Number.isFinite(amount) || amount <= 0) return ok;

  const tok = (n: number) => `${formatAvailable(n, a.decimals)} ${a.symbol}`;
  const hfBlocked =
    a.projectedHfAfter != null &&
    Number.isFinite(a.projectedHfAfter) &&
    a.projectedHfAfter < 1;

  switch (a.mode) {
    case "supply":
      if (a.frozen) return fail("This reserve is frozen — new supplies are paused.");
      if (a.walletBalance != null && amount > a.walletBalance + EPS)
        return fail(`You only have ${tok(a.walletBalance)} in your wallet.`);
      if (a.supplyCap && a.supplyCap > 0 && a.totalSupply != null && a.totalSupply + amount > a.supplyCap) {
        const room = Math.max(0, a.supplyCap - a.totalSupply);
        return fail(`Supply cap reached — at most ${tok(room)} more can be supplied.`);
      }
      return ok;

    case "withdraw":
      if (a.suppliedBalance != null && amount > a.suppliedBalance + EPS)
        return fail(`You've only supplied ${tok(a.suppliedBalance)}.`);
      if (a.availableLiquidity != null && amount > a.availableLiquidity + EPS)
        return fail(
          `Only ${tok(a.availableLiquidity)} is liquid right now — the rest is borrowed out. Withdraw less or wait for repayments.`,
        );
      if (hfBlocked)
        return fail(
          `This would drop your health factor to ${a.projectedHfAfter!.toFixed(2)} (below 1) and revert. Repay debt or withdraw less first.`,
        );
      return ok;

    case "borrow":
      if (a.frozen) return fail("This reserve is frozen — borrowing is paused.");
      if (a.canBeBorrowed === false) return fail(`${a.symbol} can't be borrowed on this market.`);
      if (a.availableLiquidity != null && amount > a.availableLiquidity + EPS)
        return fail(`Pool has only ${tok(a.availableLiquidity)} available — supply more before borrowing.`);
      if (a.availableBorrowsUsd != null && a.priceUsd && amount * a.priceUsd > a.availableBorrowsUsd + 1e-6)
        return fail(
          `Exceeds your borrowing power (~$${a.availableBorrowsUsd.toFixed(2)}). Supply more collateral first.`,
        );
      if (hfBlocked) return fail("This would drop your health factor below 1 and revert.");
      return ok;

    case "repay":
      if (a.debtBalance != null && a.debtBalance <= 0)
        return fail(`You have no ${a.symbol} debt to repay.`);
      if (a.walletBalance != null && amount > a.walletBalance + EPS)
        return fail(`You only have ${tok(a.walletBalance)} in your wallet to repay with.`);
      return ok;
  }
  return ok;
}

// Back-compat wrapper for the original borrow-only call site. Field renamed
// from the misleading `totalSupply` to `availableLiquidity` (the guard always
// compared against available pool cash, not gross supply).
export function checkBorrowLiquidity(args: {
  amountHuman: string;
  symbol: string;
  availableLiquidity: number;
  decimals: number;
}): GuardResult {
  return checkActionSafety({
    mode: "borrow",
    amountHuman: args.amountHuman,
    symbol: args.symbol,
    decimals: args.decimals,
    availableLiquidity: args.availableLiquidity,
  });
}

function formatAvailable(n: number, decimals: number): string {
  const places = Math.min(decimals, 6);
  return n.toFixed(places).replace(/\.?0+$/, "") || "0";
}
