"use client";

// TanStack Query hook that fetches the per-tx Solana signature list from
// rome-via on demand. Used by /history's row expansion — un-expanded
// rows pay nothing, expanded rows hit rome-via once and cache by hash
// for the lifetime of the page (effectively forever — historic txs
// don't change).

import { useQuery } from "@tanstack/react-query";
import { fetchViaTx, type ViaSolanaLeg } from "@/lib/via-client";
import { romeViaApiBase } from "@/lib/registry-config";

export interface TxSolanaSigs {
  sigs: ViaSolanaLeg[];
  /** Always derived — `sigs.length`. Keeps consumers from re-reading. */
  count: number;
}

export function useTxSolanaSigs(chainId: number, txHash: string | undefined, enabled: boolean) {
  return useQuery<TxSolanaSigs, Error>({
    queryKey: ["via-tx-sigs", chainId, txHash],
    enabled: enabled && !!txHash && /^0x[a-fA-F0-9]{64}$/.test(txHash ?? ""),
    queryFn: async () => {
      const base = romeViaApiBase(chainId);
      if (!base) throw new Error(`No rome-via base URL for chain ${chainId}`);
      const tx = await fetchViaTx(base, txHash!);
      const sigs = tx?.solanaLegs ?? [];
      return { sigs, count: sigs.length };
    },
    // Historic txs don't change; cache aggressively. 30 min staleTime
    // matches the longest expected explorer reindexing window.
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}
