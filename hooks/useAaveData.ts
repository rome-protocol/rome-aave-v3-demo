"use client";

// TanStack Query hooks for the demo's two main data endpoints.
// Mirrors the Rome web app's useBalances / useReserveData pattern: useQuery with
// staleTime + refetchInterval so the UI can stay fresh without spamming.

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type {
  DemoConfig,
  UserData,
  AtRiskRow,
  HistoryRow,
} from "@/lib/types";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";

const CHAIN_ID = DEFAULT_CHAIN_ID;

export function useAaveConfig() {
  return useQuery<DemoConfig, Error>({
    queryKey: ["aave-config", CHAIN_ID],
    queryFn: async () => {
      const res = await fetch(`/api/aave-config?chainId=${CHAIN_ID}`);
      if (!res.ok) throw new Error(`/api/aave-config: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useUserData() {
  const { address } = useAccount();
  return useQuery<UserData, Error>({
    queryKey: ["user-data", CHAIN_ID, address],
    enabled: !!address,
    queryFn: async () => {
      const res = await fetch(`/api/user-data?chainId=${CHAIN_ID}&user=${address}`);
      if (!res.ok) throw new Error(`/api/user-data: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 8_000,
    refetchInterval: 20_000,
  });
}

export function useAtRiskFeed(hfMax = 1.05) {
  return useQuery<{ rows: AtRiskRow[]; generatedAt: string; scannedBlock: string; borrowerCount: number }, Error>({
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
  const { address } = useAccount();
  return useQuery<{ rows: HistoryRow[]; generatedAt: string; scannedBlock: string }, Error>({
    queryKey: ["history", CHAIN_ID, address, limit],
    enabled: !!address,
    queryFn: async () => {
      const res = await fetch(`/api/history?chainId=${CHAIN_ID}&user=${address}&limit=${limit}`);
      if (!res.ok) throw new Error(`/api/history: HTTP ${res.status}`);
      return res.json();
    },
    staleTime: 8_000,
  });
}
