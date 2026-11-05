"use client";

import { useQuery } from "@tanstack/react-query";
import { usePublicClient } from "wagmi";
import { readFlashPremiumBps } from "@/lib/flash-premium";
import { hadrian } from "@/lib/wagmi";

/** Pool's flash-loan premium in basis points; bps is undefined until read (or if the read failed). */
export function useFlashPremium(pool: `0x${string}` | undefined): { bps: number | undefined; isError: boolean } {
  const client = usePublicClient({ chainId: hadrian.id });
  const q = useQuery<number, Error>({
    queryKey: ["flash-premium", pool],
    enabled: !!client && !!pool,
    queryFn: () => readFlashPremiumBps(client as never, pool!),
    staleTime: 5 * 60_000,
  });
  return { bps: q.data, isError: q.isError };
}

export const useFlashPremiumBps = (pool: `0x${string}` | undefined) => useFlashPremium(pool).bps;
