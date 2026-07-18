"use client";

// Phase-machine hook for Pool.setUserEMode. Single tx, no approve —
// flips the user's active e-mode category id. Passing id=0 disables.

import { useCallback, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { waitForReceiptWithTimeout } from "@/lib/wait-for-receipt";

export type EmodePhase = "editing" | "executing" | "success" | "error";

export interface UseAaveEmodeInput {
  pool: `0x${string}` | undefined;
  /** Target category id (0 disables). */
  categoryId: number;
}

export interface UseAaveEmodeResult {
  phase: EmodePhase;
  executeHash: `0x${string}` | null;
  error: string | null;
  submit: () => Promise<void>;
  reset: () => void;
}

export function useAaveEmode({ pool, categoryId }: UseAaveEmodeInput): UseAaveEmodeResult {
  const { address: user } = useAccount();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<EmodePhase>("editing");
  const [executeHash, setExecuteHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!user || !pool || !publicClient) {
      setError("Wallet or chain not ready");
      setPhase("error");
      return;
    }
    if (!Number.isInteger(categoryId) || categoryId < 0 || categoryId > 255) {
      setError("Invalid category id");
      setPhase("error");
      return;
    }
    setError(null);

    try {
      setPhase("executing");
      const args = [categoryId] as const;
      const est = await publicClient.estimateContractGas({
        account: user,
        address: pool,
        abi: PoolAbi,
        functionName: "setUserEMode",
        args,
      });
      const gas = (est * 13_000n) / 10_000n;
      const hash = await writeContractAsync({
        address: pool,
        abi: PoolAbi,
        functionName: "setUserEMode",
        args,
        chainId: hadrian.id,
        gas,
      });
      setExecuteHash(hash);
      await waitForReceiptWithTimeout(publicClient, hash);
      setPhase("success");

      // Switching e-mode changes LTV / liquidation threshold across the
      // user's collateral, so user-data needs a refetch. aave-config is
      // unaffected (categories themselves didn't change).
      void queryClient.invalidateQueries({ queryKey: ["user-data"] });
    } catch (e: unknown) {
      setError(decodeAaveError(e));
      setPhase("error");
    }
  }, [user, pool, publicClient, categoryId, writeContractAsync, queryClient]);

  const reset = useCallback(() => {
    setPhase("editing");
    setExecuteHash(null);
    setError(null);
  }, []);

  return { phase, executeHash, error, submit, reset };
}
