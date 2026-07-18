"use client";

// Phase-machine hook backing ActionModal for the four supply-side actions
// (supply / withdraw / borrow / repay).
//
//   useWriteContract for the approve + Pool action,
//   useReadContract  for the allowance probe,
//   publicClient.estimateContractGas for the the Rome web app 1.3× gas buffer.
//
// `submit()` runs the phase progression sequentially — `approving` only
// when the existing allowance can't cover the action, then `executing`.
// Success invalidates the user-data + aave-config TanStack queries so
// the new balances show up across Markets + Dashboard + AssetDetail
// without a manual refresh. Liquidate + FlashLoan have their own hooks.

import { useCallback, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { maxUint256, parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { Erc20Abi, PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { waitForReceiptWithTimeout } from "@/lib/wait-for-receipt";

export type ActionMode = "supply" | "withdraw" | "borrow" | "repay";
export type ActionPhase = "editing" | "approving" | "executing" | "success" | "error";

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
  const { address: user } = useAccount();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<ActionPhase>("editing");
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

    try {
      // ── Step 1: approve (only if allowance is short) ─────────────
      if (needsApprove) {
        setPhase("approving");
        const estApprove = await publicClient.estimateContractGas({
          account: user,
          address: asset,
          abi: Erc20Abi,
          functionName: "approve",
          args: [pool, maxUint256],
        });
        const gas = (estApprove * 13_000n) / 10_000n;
        const aHash = await writeContractAsync({
          address: asset,
          abi: Erc20Abi,
          functionName: "approve",
          args: [pool, maxUint256],
          chainId: hadrian.id,
          gas,
        });
        setApproveHash(aHash);
        await waitForReceiptWithTimeout(publicClient, aHash);
        await refetchAllowance();
      }

      // ── Step 2: the Pool action ──────────────────────────────────
      setPhase("executing");
      const xHash = await runAction({
        mode,
        user,
        asset,
        pool,
        amountRaw,
        publicClient,
        writeContractAsync,
      });
      setExecuteHash(xHash);
      await waitForReceiptWithTimeout(publicClient, xHash);

      setPhase("success");

      // Surface the new balances on Markets + Dashboard + AssetDetail
      // without forcing a manual refresh.
      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
    } catch (e: unknown) {
      setError(decodeAaveError(e));
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
    writeContractAsync,
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
    amountRaw,
    approveHash,
    executeHash,
    error,
    submit,
    reset,
  };
}

// Per-mode dispatch. Each call estimates gas + writes with the same 1.3×
// buffer as the faucet (the Rome web app pattern). Returning the tx hash to the
// caller lets the modal show the explorer link.

type PublicClient = NonNullable<ReturnType<typeof usePublicClient>>;
type WriteAsync = ReturnType<typeof useWriteContract>["writeContractAsync"];

async function runAction({
  mode,
  user,
  asset,
  pool,
  amountRaw,
  publicClient,
  writeContractAsync,
}: {
  mode: ActionMode;
  user: `0x${string}`;
  asset: `0x${string}`;
  pool: `0x${string}`;
  amountRaw: bigint;
  publicClient: PublicClient;
  writeContractAsync: WriteAsync;
}): Promise<`0x${string}`> {
  const bufferedGas = async (estimate: bigint) => (estimate * 13_000n) / 10_000n;

  switch (mode) {
    case "supply": {
      const est = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "supply",
        args: [asset, amountRaw, user, 0],
      });
      return writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "supply",
        args: [asset, amountRaw, user, 0],
        chainId: hadrian.id,
        gas: await bufferedGas(est),
      });
    }
    case "withdraw": {
      const est = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "withdraw",
        args: [asset, amountRaw, user],
      });
      return writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "withdraw",
        args: [asset, amountRaw, user],
        chainId: hadrian.id,
        gas: await bufferedGas(est),
      });
    }
    case "borrow": {
      const est = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "borrow",
        args: [asset, amountRaw, RATE_MODE_VARIABLE, 0, user],
      });
      return writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "borrow",
        args: [asset, amountRaw, RATE_MODE_VARIABLE, 0, user],
        chainId: hadrian.id,
        gas: await bufferedGas(est),
      });
    }
    case "repay": {
      const est = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "repay",
        args: [asset, amountRaw, RATE_MODE_VARIABLE, user],
      });
      return writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "repay",
        args: [asset, amountRaw, RATE_MODE_VARIABLE, user],
        chainId: hadrian.id,
        gas: await bufferedGas(est),
      });
    }
  }
}
