// Single-chain (Hadrian) chain store. Mirrors the shape of the Rome web app's
// chainStore so the lifted walletStore can use `useChainStore()` and
// `useChainStore.getState().chains` without modification. The demo does
// not switch between chains at runtime — fields exist to satisfy the
// interface but their setters are no-ops for chain selection.

import { create } from "zustand";
import { L2_CHAINS, type RomeChain } from "@/constants/chains";

const HADRIAN = L2_CHAINS[0];

interface ChainState {
  selectedChainId: string;
  setSelectedChainId: (chainId: string) => void;

  chainId: string;
  setChain: (chainId: string) => void;
  resetChain: () => void;

  isChainReady: boolean;
  setChainReady: (ready: boolean) => void;
  isSwitchingChain: boolean;
  setIsSwitchingChain: (switching: boolean) => void;

  chains: RomeChain[];
  setChains: (chains: RomeChain[]) => void;
}

export const useChainStore = create<ChainState>((set) => ({
  selectedChainId: HADRIAN.chainId,
  setSelectedChainId: (chainId) => set({ selectedChainId: chainId }),

  chainId: HADRIAN.chainId,
  setChain: (chainId) => set({ chainId }),
  resetChain: () => set({ chainId: HADRIAN.chainId }),

  isChainReady: true,
  setChainReady: (ready) => set({ isChainReady: ready }),
  isSwitchingChain: false,
  setIsSwitchingChain: (switching) => set({ isSwitchingChain: switching }),

  chains: L2_CHAINS,
  setChains: (chains) => set({ chains }),
}));
