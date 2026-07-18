"use client";

// Phase-machine hook for Pool.flashLoan (multi-asset entrypoint) on Rome.
//
// Rome-specific pattern: the receiver MUST be pre-approved (see
// Aave v3's PreApprovedFlashReceiverBase) — the canonical Aave V3
// in-callback approve overflows the per-sig account_locks cap when 2+
// cached SPL wrappers are involved. This hook assumes the receiver was
// pre-init'd by a deploy task; it only handles per-tx funding + the
// flashLoan call from the user's wallet.
//
// Caller responsibilities:
//   - Pass `receiver` = a pre-init'd PreApprovedFlashReceiverBase address.
//     For the public demo, lib/aave-hadrian.json#flashLoanReceivers.demoMulti.
//   - Pass `assets` + `amounts` matched arrays. Premium per asset is
//     amounts[i] * 9 / 10000 (Aave V3 default 0.09%), rounded up. We send
//     amount[i] + 1 wei safety margin per asset to fund.
//
// Phase flow:
//   editing → fundingPremium (N transfers, one per asset) → executing
//             (Pool.flashLoan tx) → success | error

import { useCallback, useMemo, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { isAddress, parseUnits } from "viem";
import { useQueryClient } from "@tanstack/react-query";
import { PoolAbi, Erc20Abi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { waitForReceiptWithTimeout } from "@/lib/wait-for-receipt";

export type Phase =
  | "editing"
  | "fundingPremium"
  | "executing"
  | "success"
  | "error";

interface UseAaveMultiFlashLoanArgs {
  pool: `0x${string}` | undefined;
  receiver: `0x${string}` | undefined;
  /** Per-asset rows: contract addr + decimals + human-amount string. */
  assets: Array<{ address: `0x${string}`; decimals: number; amount: string }>;
  /** Aave V3 default 0.09%; the Pool enforces it. */
  flashPremiumBps?: number;
}

interface UseAaveMultiFlashLoanReturn {
  phase: Phase;
  error?: string;
  amountsRaw: bigint[];
  premiumsRaw: bigint[];
  fundingTxHashes: string[];
  executeHash?: string;
  amountRawTotal: bigint;
  /** True only when every input row is valid (amount > 0, asset != 0) and the
   *  receiver/pool addresses are set. */
  isReady: boolean;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useAaveMultiFlashLoan({
  pool,
  receiver,
  assets,
  flashPremiumBps = 9,
}: UseAaveMultiFlashLoanArgs): UseAaveMultiFlashLoanReturn {
  const { address: userAddr } = useAccount();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>("editing");
  const [error, setError] = useState<string | undefined>(undefined);
  const [fundingTxHashes, setFundingTxHashes] = useState<string[]>([]);
  const [executeHash, setExecuteHash] = useState<string | undefined>(undefined);

  // Compute raw amounts + premiums.
  const { amountsRaw, premiumsRaw, amountRawTotal } = useMemo(() => {
    const amts: bigint[] = [];
    const prems: bigint[] = [];
    for (const a of assets) {
      try {
        const amt = parseUnits(a.amount || "0", a.decimals);
        amts.push(amt);
        // Match the SmokeFlashLoanReceiver convention: (amount * bps) / 10_000 + 1 safety wei
        prems.push((amt * BigInt(flashPremiumBps)) / 10000n + 1n);
      } catch {
        amts.push(0n);
        prems.push(0n);
      }
    }
    return {
      amountsRaw: amts,
      premiumsRaw: prems,
      amountRawTotal: amts.reduce((acc, v) => acc + v, 0n),
    };
  }, [assets, flashPremiumBps]);

  const isReady = useMemo(() => {
    if (!pool || !receiver || !isAddress(pool) || !isAddress(receiver)) return false;
    if (assets.length < 1) return false;
    for (let i = 0; i < assets.length; i++) {
      if (!isAddress(assets[i].address)) return false;
      if (amountsRaw[i] === 0n) return false;
    }
    return true;
  }, [pool, receiver, assets, amountsRaw]);

  const reset = useCallback(() => {
    setPhase("editing");
    setError(undefined);
    setFundingTxHashes([]);
    setExecuteHash(undefined);
  }, []);

  const submit = useCallback(async () => {
    if (!isReady || !pool || !receiver || !publicClient || !userAddr) return;
    setError(undefined);
    setFundingTxHashes([]);
    setExecuteHash(undefined);

    try {
      // ─── Phase 1: fund the receiver with premium per asset ───
      setPhase("fundingPremium");
      const fundHashes: string[] = [];
      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i].address;
        const premium = premiumsRaw[i];
        // Skip if receiver already has enough — caller may have funded ahead
        // of time (e.g., shared receiver across multiple users).
        const balance: bigint = (await publicClient.readContract({
          address: asset,
          abi: Erc20Abi,
          functionName: "balanceOf",
          args: [receiver],
        })) as bigint;
        if (balance >= premium) {
          fundHashes.push("0x"); // skipped — receiver pre-funded
          setFundingTxHashes([...fundHashes]);
          continue;
        }
        const needed = premium - balance;
        const xHash = await writeContractAsync({
          address: asset,
          abi: Erc20Abi,
          functionName: "transfer",
          args: [receiver, needed],
          chainId: hadrian.id,
        });
        await waitForReceiptWithTimeout(publicClient, xHash);
        fundHashes.push(xHash);
        setFundingTxHashes([...fundHashes]);
      }

      // ─── Phase 2: call Pool.flashLoan ───
      setPhase("executing");
      const modes = assets.map(() => 0n);
      const args = [
        receiver,
        assets.map((a) => a.address),
        amountsRaw,
        modes,
        userAddr,
        "0x",
        0,
      ] as const;

      const est = await publicClient.estimateContractGas({
        account: userAddr,
        address: pool,
        abi: PoolAbi,
        functionName: "flashLoan",
        args,
      });
      const gas = (est * 13_000n) / 10_000n;
      const xHash = await writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "flashLoan",
        args,
        chainId: hadrian.id,
        gas,
      });
      setExecuteHash(xHash);
      await publicClient.waitForTransactionReceipt({ hash: xHash });

      setPhase("success");
      void queryClient.invalidateQueries({ queryKey: ["history"] });
      void queryClient.invalidateQueries({ queryKey: ["aave-config"] });
    } catch (e: unknown) {
      setError(decodeAaveError(e));
      setPhase("error");
    }
  }, [isReady, pool, receiver, publicClient, userAddr, assets, amountsRaw, premiumsRaw, writeContractAsync, queryClient]);

  return {
    phase,
    error,
    amountsRaw,
    premiumsRaw,
    fundingTxHashes,
    executeHash,
    amountRawTotal,
    isReady,
    submit,
    reset,
  };
}
