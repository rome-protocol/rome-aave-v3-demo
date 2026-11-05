"use client";

// Pool.setUserUseReserveAsCollateral for the dashboard switch. One tx on
// either lane through the shared send path; refreshes user data after.

import { useCallback, useState } from "react";
import { usePublicClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { useSendAaveCall } from "@/hooks/useSendAaveCall";
import { PoolAbi } from "@/lib/abi";
import { hadrian } from "@/lib/wagmi";
import { decodeAaveError } from "@/lib/decode-aave-error";
import { confirmTx } from "@/lib/wait-for-receipt";
import { markFresh } from "@/lib/fresh";

export function useAaveCollateral(pool: `0x${string}`) {
  const { sendCall, wasRelayed } = useSendAaveCall();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setCollateral = useCallback(async (symbol: string, asset: string, on: boolean) => {
    if (!publicClient || pending) return;
    setError(null);
    setPending(symbol);
    try {
      const hash = await sendCall({
        address: pool,
        abi: PoolAbi,
        functionName: "setUserUseReserveAsCollateral",
        args: [asset as `0x${string}`, on],
      });
      await confirmTx(publicClient, hash, wasRelayed(hash));
      markFresh();
      await queryClient.invalidateQueries({ queryKey: ["user-data"] });
    } catch (e: unknown) {
      const msg = decodeAaveError(e);
      setError(msg.includes("health factor below 1") ? "Turning this off would push your health factor below 1." : msg);
    } finally {
      setPending(null);
    }
  }, [publicClient, pending, pool, sendCall, wasRelayed, queryClient]);

  return { setCollateral, pending, error };
}
