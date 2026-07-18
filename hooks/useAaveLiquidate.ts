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

export type LiquidatePhase = "editing" | "approving" | "executing" | "success" | "error";

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

export function useAaveLiquidate({
  collateralAsset,
  debtAsset,
  borrower,
  pool,
  debtDecimals,
  debtToCover,
}: UseAaveLiquidateInput): UseAaveLiquidateResult {
  const { address: user } = useAccount();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { writeContractAsync } = useWriteContract();
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

    try {
      if (needsApprove) {
        setPhase("approving");
        const estApprove = await publicClient.estimateContractGas({
          account: user,
          address: debtAsset,
          abi: Erc20Abi,
          functionName: "approve",
          args: [pool, maxUint256],
        });
        const gas = (estApprove * 13_000n) / 10_000n;
        const aHash = await writeContractAsync({
          address: debtAsset,
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

      setPhase("executing");
      const args = [collateralAsset, debtAsset, borrower, debtToCoverRaw, false] as const;
      const estAct = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "liquidationCall",
        args,
      });
      const gas = (estAct * 13_000n) / 10_000n;
      const xHash = await writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "liquidationCall",
        args,
        chainId: hadrian.id,
        gas,
      });
      setExecuteHash(xHash);
      await waitForReceiptWithTimeout(publicClient, xHash);

      setPhase("success");

      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
      void queryClient.invalidateQueries({ queryKey: ["at-risk"] });
    } catch (e: unknown) {
      setError(decodeAaveError(e));
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
    debtToCoverRaw,
    approveHash,
    executeHash,
    error,
    submit,
    reset,
  };
}
