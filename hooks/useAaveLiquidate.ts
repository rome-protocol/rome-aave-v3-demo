"use client";

// Phase-machine hook for liquidationCall. Mirrors useAaveAction's shape
// but the signature is liquidationCall-specific (collateral + debt +
// borrower + debtToCover). Allowance is checked against `debtAsset`,
// not the action target — the Pool pulls debtToCover of the debt asset
// from the caller and routes bonus collateral back.
//
// receiveAToken = false: caller wants the underlying collateral token
// (matches the design's "you receive" preview). Switching to true is a
// niche flow (a 5th button on the Liquidation modal) we don't expose.
//
// Solana lane: the synthetic holds nothing at rest, so the debt asset is moved
// in from the wallet first (only the missing part), and the seized collateral
// plus any leftover debt token are swept back to the wallet afterwards.

import { useCallback, useMemo, useState } from "react";
import {
  usePublicClient,
  useReadContract,
} from "wagmi";
import { useActiveAddress } from "@/hooks/useActiveLane";
import { useSendAaveCall } from "@/hooks/useSendAaveCall";
import { formatUnits, maxUint256, parseUnits } from "viem";
import { useSyntheticLegs } from "@/hooks/useSyntheticLegs";
import { fundShortfall } from "@/lib/solana/legs";
import { useQueryClient } from "@tanstack/react-query";
import { Erc20Abi, PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { confirmTx, TxNotConfirmedError } from "@/lib/wait-for-receipt";
import { refreshAtRiskBorrower } from "./useAaveData";
import { markFresh } from "@/lib/fresh";

export type LiquidatePhase = "editing" | "funding" | "approving" | "executing" | "sweeping" | "success" | "error";

export interface UseAaveLiquidateInput {
  collateralAsset: `0x${string}` | undefined;
  debtAsset: `0x${string}` | undefined;
  borrower: `0x${string}` | undefined;
  pool: `0x${string}` | undefined;
  debtDecimals: number;
  debtToCover: string;
}

export interface UseAaveLiquidateResult {
  phase: LiquidatePhase;
  needsApprove: boolean;
  debtToCoverRaw: bigint;
  approveHash: `0x${string}` | null;
  executeHash: `0x${string}` | null;
  error: string | null;
  submit: () => Promise<void>;
  reset: () => void;
}

// Polls the synthetic's collateral balance (20 x 1.5 s, like waitForNonceAdvance) until it grows.
async function collateralLanded(
  balanceOf: (asset: `0x${string}`) => Promise<bigint>,
  asset: `0x${string}`,
  before: bigint,
  tries = 20,
  waitMs = 1500,
): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await balanceOf(asset)) > before) return true;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

export function useAaveLiquidate({
  collateralAsset,
  debtAsset,
  borrower,
  pool,
  debtDecimals,
  debtToCover,
}: UseAaveLiquidateInput): UseAaveLiquidateResult {
  const { address: user } = useActiveAddress();
  const { lane, sendCall, ensureWrapperGrant, wasRelayed } = useSendAaveCall();
  const legs = useSyntheticLegs();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<LiquidatePhase>("editing");
  const [approveHash, setApproveHash] = useState<`0x${string}` | null>(null);
  const [executeHash, setExecuteHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const debtToCoverRaw = useMemo<bigint>(() => {
    if (!debtToCover) return 0n;
    if (debtToCover.toLowerCase() === "max") return maxUint256;
    try {
      const parsed = parseUnits(debtToCover, debtDecimals);
      return parsed > 0n ? parsed : 0n;
    } catch {
      return 0n;
    }
  }, [debtToCover, debtDecimals]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: debtAsset,
    abi: Erc20Abi,
    functionName: "allowance",
    args: user && pool ? [user, pool] : undefined,
    chainId: hadrian.id,
    query: { enabled: !!user && !!debtAsset && !!pool },
  });

  const allowanceTarget = debtToCoverRaw === maxUint256 ? maxUint256 : debtToCoverRaw;
  const needsApprove = (allowance ?? 0n) < allowanceTarget;

  const submit = useCallback(async () => {
    // A new attempt starts clean: a link from an earlier attempt must not show in this one's error phase.
    setApproveHash(null);
    setExecuteHash(null);
    if (!user || !collateralAsset || !debtAsset || !borrower || !pool || !publicClient) {
      setError("Wallet or chain not ready");
      setPhase("error");
      return;
    }
    if (debtToCoverRaw === 0n) {
      setError("debtToCover must be > 0");
      setPhase("error");
      return;
    }
    if (user.toLowerCase() === borrower.toLowerCase()) {
      setError("Cannot liquidate your own position");
      setPhase("error");
      return;
    }
    setError(null);

    let funded = false;
    let executeSent = false;
    try {
      // Solana lane: move the missing debt asset from the wallet into the synthetic.
      if (lane === "solana") {
        if (debtToCoverRaw === maxUint256) throw new Error("Enter an explicit amount to liquidate from a Solana wallet.");
        const held = await legs.syntheticBalance(debtAsset);
        const shortfall = fundShortfall(held, debtToCoverRaw);
        if (shortfall > 0n) {
          const inWallet = await legs.walletBalance(debtAsset);
          if (inWallet < shortfall) {
            throw new Error(`Your wallet holds ${formatUnits(inWallet, debtDecimals)} and this needs ${formatUnits(shortfall, debtDecimals)} more than the ${formatUnits(held, debtDecimals)} already available.`);
          }
          setPhase("funding");
          await legs.fund(debtAsset, shortfall);
          funded = true;
        }
      }

      // The wrapper moves the debt asset as the liquidator's delegate: enable it once. Always
      // checked (idempotent), because an existing allowance does not mean the wrapper is enabled.
      setPhase("approving");
      const gHash = await ensureWrapperGrant(debtAsset);
      if (gHash) await confirmTx(publicClient, gHash, wasRelayed(gHash), { linkInMessage: true });
      if (needsApprove) {
        const aHash = await sendCall({ address: debtAsset, abi: Erc20Abi, functionName: "approve", args: [pool, maxUint256] });
        setApproveHash(aHash);
        await confirmTx(publicClient, aHash, wasRelayed(aHash), { linkInMessage: true });
        await refetchAllowance();
      }

      setPhase("executing");
      // A relayed (iterative) liquidation's receipt is polled for (about 13 s); on the Solana lane
      // success is also checked by the seized collateral landing in the synthetic.
      const collatBefore = lane === "solana" ? await legs.syntheticBalance(collateralAsset) : 0n;
      const args = [collateralAsset, debtAsset, borrower, debtToCoverRaw, false] as const;
      const xHash = await sendCall({ address: pool, abi: PoolAbi, functionName: "liquidationCall", args });
      executeSent = true;
      setExecuteHash(xHash);
      await confirmTx(publicClient, xHash, wasRelayed(xHash));
      // The proxy's view trails Solana confirmation, so give the seized collateral time to show.
      if (lane === "solana" && !(await collateralLanded(legs.syntheticBalance, collateralAsset, collatBefore))) {
        throw new Error("The liquidation did not go through: no collateral was received. Check the borrower's health factor and try again.");
      }

      // Solana lane: the seized collateral and any unused debt token go back to the wallet.
      if (lane === "solana") {
        setPhase("sweeping");
        for (const asset of [collateralAsset, debtAsset]) {
          const { evmTxHash } = await legs.sweepAll(asset);
          if (evmTxHash) await confirmTx(publicClient, evmTxHash, false, { linkInMessage: true });
        }
      }

      setPhase("success");

      markFresh();

      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
      void refreshAtRiskBorrower(borrower).then(() => queryClient.invalidateQueries({ queryKey: ["at-risk"] }));
    } catch (e: unknown) {
      // Funded debt token must not stay stranded in the synthetic after a failed attempt.
      // A seizure that lands late must not stay stranded either (sweepAll does nothing at 0).
      if (funded && debtAsset) await legs.sweepAll(debtAsset).catch(() => undefined);
      let message = decodeAaveError(e);
      if (executeSent && lane === "solana" && collateralAsset) {
        const swept = await legs.sweepAll(collateralAsset).catch(() => null);
        if (e instanceof TxNotConfirmedError) {
          if (!swept) message += " Returning the collateral to your wallet failed; it is still in your Rome account.";
          else if (swept.tokens > 0n) message += " The collateral was returned to your wallet.";
        }
      }
      setError(message);
      setPhase("error");
    }
  }, [
    user,
    collateralAsset,
    debtAsset,
    borrower,
    pool,
    publicClient,
    debtToCoverRaw,
    needsApprove,
    lane,
    legs,
    debtDecimals,
    sendCall,
    ensureWrapperGrant,
    wasRelayed,
    refetchAllowance,
    queryClient,
  ]);

  const reset = useCallback(() => {
    setPhase("editing");
    setApproveHash(null);
    setExecuteHash(null);
    setError(null);
  }, []);

  return {
    phase,
    needsApprove,
    debtToCoverRaw,
    approveHash,
    executeHash,
    error,
    submit,
    reset,
  };
}
