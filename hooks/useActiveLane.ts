"use client";

// The ONE place the app decides which identity it acts under. Every read and
// write binds to `address` from here — never to wagmi's useAccount() directly —
// so a Solana wallet's synthetic EVM address and an EVM wallet's own address
// flow through the same code. The inactive lane reads as disconnected.

import { useMemo } from "react";
import { useUniWallet } from "@/hooks/useUniWallet";
import { useLaneStore } from "@/store/laneStore";
import { decideActiveLane, type Lane } from "@/lib/lane/activeLane";
import { syntheticAddress } from "@/lib/lane/identity";

export interface ActiveLane {
  lane: Lane | null;
  /** The EVM address the app acts as: the EVM wallet's, or the Solana wallet's synthetic. */
  address: `0x${string}` | null;
  /** Base58 public key of the connected Solana wallet — only when the Solana lane is active. */
  solanaAddress: string | null;
  isConnected: boolean;
  /** Both wallets hold a session and no preference is stored: a click must pick one. */
  undecided: boolean;
  /** The lane whose live session the provider must drop. */
  evict: Lane | null;
}

export function useActiveLane(): ActiveLane {
  const w = useUniWallet();
  const preferred = useLaneStore((s) => s.preferred);
  const evmConnected = w.evmConnected && !!w.evmAddress;
  const solanaConnected = w.solanaConnected && !!w.solanaAddress;
  const decision = decideActiveLane({ evmConnected, solanaConnected }, preferred);
  const solanaAddress = decision.active === "solana" ? w.solanaAddress : null;
  const address = useMemo<`0x${string}` | null>(() => {
    if (decision.active === "evm") return (w.evmAddress as `0x${string}`) ?? null;
    if (decision.active === "solana" && solanaAddress) return syntheticAddress(solanaAddress);
    return null;
  }, [decision.active, w.evmAddress, solanaAddress]);
  return {
    lane: decision.active,
    address,
    solanaAddress,
    isConnected: address !== null,
    undecided: decision.active === null && evmConnected && solanaConnected,
    evict: decision.evict,
  };
}

export function useActiveAddress(): Pick<ActiveLane, "address" | "lane" | "isConnected"> {
  const { address, lane, isConnected } = useActiveLane();
  return { address, lane, isConnected };
}
