"use client";

// Phase-machine hook backing ActionModal for the four supply-side actions
// (supply / withdraw / borrow / repay).
//
//   useSendAaveCall for the grant + approve + Pool action (EVM wallet or Solana wallet),
//   useReadContract  for the allowance probe,
//   publicClient.estimateContractGas for the Rome web app 1.3× gas buffer.
//
// `submit()` runs the phase progression sequentially — `approving` only
// when the existing allowance can't cover the action, then `executing`.
// Success invalidates the user-data + aave-config TanStack queries so
// the new balances show up across Markets + Dashboard + AssetDetail
// without a manual refresh. Liquidate + FlashLoan have their own hooks.

import { useCallback, useMemo, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useSendAaveCall } from "@/hooks/useSendAaveCall";
import { useSyntheticLegs } from "@/hooks/useSyntheticLegs";
import { fundShortfall, withAccrualBuffer } from "@/lib/solana/legs";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { Erc20Abi, PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { requireSuccess, TxNotConfirmedError } from "@/lib/wait-for-receipt";
import { markFresh } from "@/lib/fresh";

export type ActionMode = "supply" | "withdraw" | "borrow" | "repay";
export type ActionPhase = "editing" | "funding" | "granting" | "approving" | "executing" | "depositing" | "relaying" | "sweeping" | "success" | "error";

const RATE_MODE_VARIABLE = 2n;

export interface UseAaveActionInput {
  mode: ActionMode;
  asset: `0x${string}` | undefined; // underlying token (reserve.contract)
  pool: `0x${string}` | undefined;
  decimals: number;
  amount: string;
  /**
   * User's full balance for this mode in human units (suppliedBalance for
   * withdraw, debtBalance for repay). When the entered amount meets-or-exceeds
   * it, we send `type(uint256).max` instead of the parsed number so interest
   * accrued since the last balance read doesn't leave dust — or, for withdraw,
   * underflow because the rounded display exceeded the true scaled balance.
   */
  maxAmount?: number;
}

export interface UseAaveActionResult {
  phase: ActionPhase;
  needsApprove: boolean;
  amountRaw: bigint;
  /** Solana lane: the wallet → synthetic top-up this action needed (Solana signature). */
  fundSignature: string | null;
  /** Solana lane: the synthetic → wallet return of what the action produced (EVM tx hash). */
  sweepHash: `0x${string}` | null;
  /** Solana lane, native SOL: the Solana signature that turned the returned wrapped SOL into plain SOL. */
  unwrapSignature: string | null;
  /** The one-time wrapper enable, when this action had to send it. */
  grantHash: `0x${string}` | null;
  approveHash: `0x${string}` | null;
  executeHash: `0x${string}` | null;
  error: string | null;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useAaveAction({
  mode,
  maxAmount,
  asset,
  pool,
  decimals,
  amount,
}: UseAaveActionInput): UseAaveActionResult {
  const { address: user, lane } = useActiveAddress();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { sendCall, ensureWrapperGrant, wasRelayed } = useSendAaveCall();
  const legs = useSyntheticLegs();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<ActionPhase>("editing");
  const [fundSignature, setFundSignature] = useState<string | null>(null);
  const [sweepHash, setSweepHash] = useState<`0x${string}` | null>(null);
  const [unwrapSignature, setUnwrapSignature] = useState<string | null>(null);
  const [grantHash, setGrantHash] = useState<`0x${string}` | null>(null);
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [executeHash, setExecuteHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Decode amount once per change. `parseUnits` will throw on garbage,
  // so we catch and emit 0n — the submit guard handles that.
  const amountRaw = useMemo<bigint>(() => {
    if (!amount) return 0n;
    if (amount.toLowerCase() === "max") {
      return mode === "repay" || mode === "withdraw" ? maxUint256 : 0n;
    }
    try {
      const parsed = parseUnits(amount, decimals);
      if (parsed <= 0n) return 0n;
      // Full withdraw/repay → send the protocol's MAX sentinel so accrued
      // interest doesn't leave dust (repay) or underflow the scaled-balance
      // burn (withdraw) when the rounded display slightly exceeds the true
      // on-chain balance.
      if (
        (mode === "withdraw" || mode === "repay") &&
        maxAmount != null &&
        maxAmount > 0 &&
        Number(amount) >= maxAmount
      ) {
        return maxUint256;
      }
      return parsed;
    } catch {
      return 0n;
    }
  }, [amount, decimals, mode, maxAmount]);

  // Allowance probe — only relevant for the two modes that pull tokens
  // from the user (supply / repay). Borrow + withdraw flow tokens OUT of
  // the pool so no approve is needed.
  const needsAllowance = mode === "supply" || mode === "repay";
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: asset,
    abi: Erc20Abi,
    functionName: "allowance",
    args: user && pool ? [user, pool] : undefined,
    chainId: hadrian.id,
    query: { enabled: !!user && !!asset && !!pool && needsAllowance },
  });

  // For MAX-repay we need maxUint256 of allowance; otherwise just enough
  // to cover the action amount.
  const allowanceTarget =
    mode === "repay" && amountRaw === maxUint256 ? maxUint256 : amountRaw;
  const needsApprove = needsAllowance && (allowance ?? 0n) < allowanceTarget;

  const submit = useCallback(async () => {
    // A new attempt starts clean: a link from an earlier attempt must not show in this one's error phase.
    setFundSignature(null);
    setSweepHash(null);
    setUnwrapSignature(null);
    setGrantHash(null);
    setApproveHash(null);
    setExecuteHash(null);
    if (!user || !asset || !pool || !publicClient) {
      setError("Wallet or chain not ready");
      setPhase("error");
      return;
    }
    if (amountRaw === 0n) {
      setError("Amount must be > 0");
      setPhase("error");
      return;
    }

    setError(null);
    let funded = false; // tokens moved wallet → synthetic by this action
    let sweptInStep3 = false; // the step-3 sweep already ran and reported its own result

    try {
      // ── Solana lane, step −1: top the synthetic up from the wallet ─────
      // The synthetic holds nothing at rest; what supply/repay pulls must be
      // moved in first, and only the missing part.
      if (lane === "solana" && needsAllowance) {
        const needed = amountRaw === maxUint256
          ? withAccrualBuffer(parseUnits(String(maxAmount ?? 0), decimals))
          : amountRaw;
        const held = await legs.syntheticBalance(asset);
        const shortfall = fundShortfall(held, needed);
        if (shortfall > 0n) {
          const inWallet = await legs.walletBalance(asset);
          if (inWallet < shortfall) {
            throw new Error(`Your wallet holds ${formatUnits(inWallet, decimals)} and this needs ${formatUnits(shortfall, decimals)} more than the ${formatUnits(held, decimals)} already available.`);
          }
          setPhase("funding");
          const sig = await legs.fund(asset, shortfall);
          funded = true;
          setFundSignature(sig);
        }
      }

      // ── Step 0: enable the wrapper (once per wrapper, when tokens leave the wallet) ──
      // The wrapper moves SPL as the holder's delegate; without this one-time
      // grant a supply/repay reverts inside the wrapper even with allowance.
      if (needsAllowance) {
        setPhase("granting");
        const gHash = await ensureWrapperGrant(asset);
        if (gHash) {
          setGrantHash(gHash);
          await requireSuccess(publicClient, gHash, wasRelayed(gHash), { linkInMessage: true });
        }
      }

      // ── Step 1: approve (only if allowance is short) ─────────────
      if (needsApprove) {
        setPhase("approving");
        const aHash = await sendCall({ address: asset, abi: Erc20Abi, functionName: "approve", args: [pool, maxUint256] });
        setApproveHash(aHash);
        await requireSuccess(publicClient, aHash, wasRelayed(aHash), { linkInMessage: true });
        await refetchAllowance();
      }

      // ── Step 2: the Pool action ──────────────────────────────────
      setPhase("executing");
      const xHash = await sendCall(actionCall({ mode, user, asset, pool, amountRaw }), { onPhase: (p) => setPhase(p) });
      setExecuteHash(xHash);
      // A reverted tx is an error, never "success"; a relayed send's receipt is polled for. A relayed send
      // returns only after its legs landed, so a missing receipt still lets the sweep below run.
      let unconfirmed: TxNotConfirmedError | null = null;
      try {
        await requireSuccess(publicClient, xHash, wasRelayed(xHash));
      } catch (e) {
        if (!(e instanceof TxNotConfirmedError) || lane !== "solana") throw e;
        unconfirmed = e;
      }

      // ── Solana lane, step 3: return what the action produced (or left over) to the wallet ──
      if (lane === "solana" && (mode === "withdraw" || mode === "borrow" || (mode === "repay" && amountRaw === maxUint256))) {
        setPhase("sweeping");
        sweptInStep3 = true;
        try {
          const swept = await legs.sweepAll(asset);
          if (swept.evmTxHash) setSweepHash(swept.evmTxHash);
          if (swept.closeSignature) setUnwrapSignature(swept.closeSignature);
          if (unconfirmed && swept.tokens > 0n) unconfirmed.message += " The funds were returned to your wallet.";
        } catch (se: unknown) {
          if (!unconfirmed) throw se;
          unconfirmed.message += ` Returning the funds to your wallet failed (${decodeAaveError(se)}); they are still in your Rome account.`;
        }
      }
      if (unconfirmed) throw unconfirmed;

      setPhase("success");

      // Surface the new balances on Markets + Dashboard + AssetDetail
      // without forcing a manual refresh.
      markFresh();
      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
    } catch (e: unknown) {
      let message = decodeAaveError(e);
      // A step after funding failed: send what was moved in back to the wallet (best effort).
      if (funded && lane === "solana" && !(sweptInStep3 && e instanceof TxNotConfirmedError)) {
        try {
          setPhase("sweeping");
          const swept = await legs.sweepAll(asset);
          if (swept.evmTxHash) setSweepHash(swept.evmTxHash);
          if (swept.closeSignature) setUnwrapSignature(swept.closeSignature);
          message += swept.tokens > 0n ? " The funds moved in for this action were returned to your wallet." : "";
        } catch (se: unknown) {
          message += ` Returning the funds to your wallet also failed (${decodeAaveError(se)}); they are still in your Rome account.`;
        }
      }
      setError(message);
      setPhase("error");
    }
  }, [
    mode,
    user,
    asset,
    pool,
    publicClient,
    amountRaw,
    needsApprove,
    needsAllowance,
    lane,
    legs,
    maxAmount,
    decimals,
    sendCall,
    ensureWrapperGrant,
    wasRelayed,
    refetchAllowance,
    queryClient,
  ]);

  const reset = useCallback(() => {
    setPhase("editing");
    setFundSignature(null);
    setSweepHash(null);
    setUnwrapSignature(null);
    setGrantHash(null);
    setApproveHash(null);
    setExecuteHash(null);
    setError(null);
  }, []);

  return {
    phase,
    needsApprove,
    amountRaw,
    fundSignature,
    sweepHash,
    unwrapSignature,
    grantHash,
    approveHash,
    executeHash,
    error,
    submit,
    reset,
  };
}

// Per-mode call descriptor. The lane-agnostic `sendCall` estimates + sends it
// (EVM wallet: wagmi with the 1.3× buffer; Solana wallet: atomic TxV1 via the proxy).
export function actionCall({
  mode,
  user,
  asset,
  pool,
  amountRaw,
}: {
  mode: ActionMode;
  user: `0x${string}`;
  asset: `0x${string}`;
  pool: `0x${string}`;
  amountRaw: bigint;
}): { address: `0x${string}`; abi: typeof PoolAbi; functionName: "supply" | "withdraw" | "borrow" | "repay"; args: readonly unknown[] } {
  switch (mode) {
    case "supply":
      return { address: pool, abi: PoolAbi, functionName: "supply", args: [asset, amountRaw, user, 0] };
    case "withdraw":
      return { address: pool, abi: PoolAbi, functionName: "withdraw", args: [asset, amountRaw, user] };
    case "borrow":
      return { address: pool, abi: PoolAbi, functionName: "borrow", args: [asset, amountRaw, RATE_MODE_VARIABLE, 0, user] };
    case "repay":
      return { address: pool, abi: PoolAbi, functionName: "repay", args: [asset, amountRaw, RATE_MODE_VARIABLE, user] };
  }
}
