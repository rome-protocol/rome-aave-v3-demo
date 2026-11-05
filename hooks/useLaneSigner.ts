"use client";

// The LaneSigner for the connected Solana wallet. Reaches the Wallet Standard
// wallet through the adapter (modern wallets) or by name through discovery
// (a legacy adapter whose extension also registered as Standard). For the
// AUTH hash, wallet-adapter's own `signMessage` is the same raw-bytes contract
// and is accepted when the Standard feature is absent. The v1 wire has ONLY the
// Standard `solana:signTransaction` seam — no fallback.

import { useCallback } from "react";
import { toast } from "react-toastify";
import { useUniWallet } from "@/hooks/useUniWallet";
import { useActiveLane } from "@/hooks/useActiveLane";
import { getChain, DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import { findStandardWallet, standardWalletOf, walletLaneSigner, SIGN_MESSAGE, type LaneSigner, type StandardWalletLike } from "@/lib/lane/walletStandard";

export function useLaneSigner(): () => LaneSigner {
  const w = useUniWallet();
  const active = useActiveLane();
  return useCallback((): LaneSigner => {
    if (active.lane !== "solana" || !active.solanaAddress) throw new Error("Connect a Solana wallet first.");
    const adapter = w.solanaAdapter as { name?: string } | null;
    let wallet: StandardWalletLike | null = standardWalletOf(adapter);
    if (!wallet && adapter?.name) wallet = findStandardWallet(adapter.name);
    if (!wallet) throw new Error("This wallet did not announce a Wallet Standard interface, which signing a Rome transaction needs. Update the extension.");
    const signMsg = w.solanaSignMessage;
    if (!wallet.features[SIGN_MESSAGE] && signMsg) {
      wallet = { ...wallet, features: { ...wallet.features, [SIGN_MESSAGE]: { signMessage: async (...inputs: { message: Uint8Array }[]) => Promise.all(inputs.map(async (i) => ({ signature: await signMsg(i.message) }))) } } };
    }
    const cluster = getChain(DEFAULT_CHAIN_ID)?.solana?.cluster ?? "devnet";
    return walletLaneSigner(wallet, active.solanaAddress, `solana:${cluster}`, (note) => toast.info(note));
  }, [w.solanaAdapter, w.solanaSignMessage, active.lane, active.solanaAddress]);
}
