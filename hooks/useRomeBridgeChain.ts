// Lifted from the Rome web app. Single source of truth for "which Rome chain is the
// app wired against right now". For this single-chain demo it always returns
// Hadrian. Kept hook-shaped so lifted components (NetworkSetupHelp, etc.)
// work without modification + future multi-chain support is a chainStore
// change, not a consumer change.

import { useChainStore } from "@/store/chainStore";
import type { RomeChain } from "@/constants/chains";

export interface RomeBridgeChain {
  chainId: number;
  chainIdString: string;
  chain: RomeChain | undefined;
  isReady: boolean;
}

export function useRomeBridgeChain(): RomeBridgeChain {
  const chainIdString = useChainStore((s) => s.chainId);
  const chains = useChainStore((s) => s.chains);

  const chainId = chainIdString ? Number(chainIdString) : NaN;
  const isReady = !!chainIdString && Number.isFinite(chainId);
  const chain = chains.find((c) => c.chainId === chainIdString);

  return { chainId, chainIdString, chain, isReady };
}
