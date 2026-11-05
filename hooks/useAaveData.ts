"use client";

// TanStack Query hooks for the demo's two main data endpoints.
// Mirrors rome-ui's useBalances / useReserveData pattern: useQuery with
// staleTime + refetchInterval so the UI can stay fresh without spamming.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useActiveAddress, useActiveLane } from "@/hooks/useActiveLane";
import { readWalletSide } from "@/lib/solana/walletBalance";
import type {
  DemoConfig,
  UserData,
  AtRiskRow,
  HistoryRow,
} from "@/lib/types";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import { freshParam } from "@/lib/fresh";
import type { MarketOverview } from "@/lib/market-split";

const CHAIN_ID = DEFAULT_CHAIN_ID;

export function useAaveConfig() {
  return useQuery<DemoConfig, Error>({
    queryKey: ["aave-config", CHAIN_ID],
    queryFn: async () => {
      const res = await fetch(`/api/aave-config?chainId=${CHAIN_ID}${freshParam()}`);
      if (!res.ok) throw new Error(`/api/aave-config: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

/** EVM / Solana split of the market; null while the server builds its first snapshot (polled every 3 s until then). */
export function useMarketOverview() {
  return useQuery<MarketOverview | null, Error>({
    queryKey: ["market-overview", CHAIN_ID],
    queryFn: async () => {
      const res = await fetch(`/api/market-overview?chainId=${CHAIN_ID}`);
      if (res.status === 202) return null;
      if (!res.ok) throw new Error(`/api/market-overview: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: (q) => (q.state.data ? 30_000 : 3_000),
  });
}

export function useUserData() {
  const { address, lane, solanaAddress } = useActiveLane();
  const { connection } = useConnection();
  const config = useAaveConfig();
  const q = useQuery<UserData, Error>({
    queryKey: ["user-data", CHAIN_ID, address],
    enabled: !!address,
    queryFn: async () => {
      const res = await fetch(`/api/user-data?chainId=${CHAIN_ID}&user=${address}${freshParam()}`);
      if (!res.ok) throw new Error(`/api/user-data: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  // Solana lane: the server reads the synthetic only. What the wallet itself
  // holds (token account, plus plain SOL for SOL) is added here, so the
  // "Wallet" balance, Max and the guard see what the fund leg can move in.
  const reserves = config.data?.reserves;
  const onSolana = lane === "solana" && !!solanaAddress;
  const side = useQuery<Record<string, number>, Error>({
    queryKey: ["user-data", "solana-wallet", solanaAddress, reserves?.map((r) => r.solanaMint).join(",")],
    enabled: onSolana && !!reserves,
    queryFn: async () => {
      const list = reserves!.filter((r) => r.solanaMint);
      const amounts = await readWalletSide(connection, new PublicKey(solanaAddress!), list.map((r) => new PublicKey(r.solanaMint!)));
      return Object.fromEntries(list.map((r, i) => [r.symbol, Number(amounts[i]) / 10 ** r.decimals]));
    },
    staleTime: 8_000,
    refetchInterval: 20_000,
  });

  return useMemo(() => {
    if (!onSolana) return q;
    const merged = q.data && side.data
      ? { ...q.data, positions: Object.fromEntries(Object.entries(q.data.positions).map(([sym, p]) => [sym, { ...p, walletBalance: p.walletBalance + (side.data![sym] ?? 0) }])) }
      : undefined;
    return { ...q, data: merged, isLoading: q.isLoading || side.isLoading, isError: q.isError || side.isError, error: q.error ?? side.error } as typeof q;
  }, [q, side.data, side.isLoading, side.isError, side.error, onSolana]);
}

/** Ask the server to re-read one borrower now (after a liquidation), so the list shows the new row without waiting for its refresh. */
export async function refreshAtRiskBorrower(borrower: string): Promise<void> {
  await fetch(`/api/at-risk?chainId=${CHAIN_ID}&hfMax=2&refresh=${borrower}`).catch(() => undefined);
}

export function useAtRiskFeed(hfMax = 1.05) {
  return useQuery<{ rows: AtRiskRow[]; generatedAt: string; ageSeconds?: number; scannedBlock: string; borrowerCount: number }, Error>({
    queryKey: ["at-risk", CHAIN_ID, hfMax],
    queryFn: async () => {
      const res = await fetch(`/api/at-risk?chainId=${CHAIN_ID}&hfMax=${hfMax}`);
      if (!res.ok) throw new Error(`/api/at-risk: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 6_000,
    refetchInterval: 6_000,
  });
}

export function useUserHistory(limit = 50) {
  const { address } = useActiveAddress();
  return useQuery<{ rows: HistoryRow[]; generatedAt: string; scannedBlock: string }, Error>({
    queryKey: ["history", CHAIN_ID, address, limit],
    enabled: !!address,
    queryFn: async () => {
      const res = await fetch(`/api/history?chainId=${CHAIN_ID}&user=${address}&limit=${limit}`);
      if (!res.ok) throw new Error(`/api/history: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 8_000,
    // One retry at most: each failed attempt is a server-side scan on the shared RPC.
    retry: 1,
  });
}
