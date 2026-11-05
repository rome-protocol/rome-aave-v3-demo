"use client";

// What an asset is called on screen, by lane (lib/assetIdentity.ts). The mark is by mint in both lanes.

import { useAaveConfig } from "@/hooks/useAaveData";
import { useActiveLane } from "@/hooks/useActiveLane";
import { useTokenIdentities, useTokenIdentity } from "@/lib/tokenIdentity";
import { shownIdentity } from "@/lib/assetIdentity";
import type { Reserve } from "@/lib/types";

export interface AssetIdentity { symbol: string; name: string; mint: string | null }

/** The identity to show for a reserve (found by its display symbol). `name` is the wrapper's name when the caller has it. */
export function useAssetIdentity(symbol: string, name?: string): AssetIdentity {
  const { data } = useAaveConfig();
  const { lane } = useActiveLane();
  const reserve = data?.reserves.find((r) => r.symbol === symbol);
  const mint = reserve?.solanaMint ?? null;
  const id = useTokenIdentity(mint);
  const wrapperName = name ?? reserve?.name ?? "";
  return { ...shownIdentity(lane, id, { symbol, name: wrapperName }), mint };
}

/** The same for a list of reserves (the picker), in the same order. */
export function useAssetIdentities(reserves: Reserve[]): AssetIdentity[] {
  const { lane } = useActiveLane();
  const mints = reserves.map((r) => r.solanaMint);
  const ids = useTokenIdentities(mints);
  return reserves.map((r, i) => {
    return { ...shownIdentity(lane, ids[i] ?? null, { symbol: r.symbol, name: r.name }), mint: r.solanaMint };
  });
}
