"use client";

// Money in and out of the Solana wallet's synthetic, for the Solana lane only.
//   fund(wrapper, tokens)  — ONE wallet-signed native v1 tx (ensure synthetic ATA + ActivateAta).
//                            For native SOL the same tx first tops the wallet's wSOL
//                            account up from plain SOL (create if missing, transfer, syncNative).
//   sweepAll(wrapper)      — the synthetic's whole balance of that asset back to the
//                            wallet: ensure the wallet's ATA (native, wallet-signed)
//                            then transfer_spl from the synthetic over the atomic lane;
//                            for native SOL the wallet's wSOL account is then closed,
//                            so the user ends with plain SOL.
// The mint is read from the wrapper (`mint_id()`), never assumed.

import { useCallback } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { usePublicClient } from "wagmi";
import { PublicKey } from "@solana/web3.js";
import { hexToBytes, type Hex } from "viem";
import { hadrian } from "@/lib/wagmi";
import hadrianChain from "@/lib/hadrian-chain.json";
import { Erc20Abi } from "@/lib/abi";
import { SPL_WRAPPER_PROBE_ABI } from "@/lib/wrapperGrant";
import { useActiveLane } from "@/hooks/useActiveLane";
import { useLaneSigner } from "@/hooks/useLaneSigner";
import { useSendAaveCall } from "@/hooks/useSendAaveCall";
import { buildFundInstructions, buildSweepLeg } from "@/lib/solana/legs";
import { associatedTokenAddress } from "@/lib/solana/pdas";
import { sendNativeV1 } from "@/lib/solana/nativeV1";
import { isNativeMint, readWalletSide, tokenAmountOf } from "@/lib/solana/walletBalance";
import { requireSuccess } from "@/lib/wait-for-receipt";

const SOLANA_RPC = "/api/solana-rpc";

export interface SweepResult {
  /** The synthetic → wallet transfer (EVM tx hash); null when there was nothing to move. */
  evmTxHash: Hex | null;
  tokens: bigint;
  /** Native SOL: the Solana signature that closed the wallet's wSOL account into plain SOL. */
  closeSignature: string | null;
}

export interface SyntheticLegs {
  /** Base units of `wrapper` the synthetic holds (its ATA, read through the wrapper). */
  syntheticBalance: (wrapper: Hex) => Promise<bigint>;
  /** Base units the wallet itself can put in: its token account for the wrapper's mint (+ plain SOL minus the fee reserve for native SOL). */
  walletBalance: (wrapper: Hex) => Promise<bigint>;
  /** Moves `tokens` wallet → synthetic. Resolves to the Solana signature. */
  fund: (wrapper: Hex, tokens: bigint) => Promise<string>;
  /** Moves the synthetic's whole balance of `wrapper` back to the wallet. */
  sweepAll: (wrapper: Hex) => Promise<SweepResult>;
}

export function useSyntheticLegs(): SyntheticLegs {
  const { connection } = useConnection();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const laneSigner = useLaneSigner();
  const active = useActiveLane();
  const { sendRaw, wasRelayed } = useSendAaveCall();
  const programId = new PublicKey(hadrianChain.romeEvmProgramId);

  const requireSolana = useCallback(() => {
    if (active.lane !== "solana" || !active.solanaAddress || !active.address) throw new Error("Connect a Solana wallet first.");
    return { wallet: new PublicKey(active.solanaAddress), synthetic: active.address };
  }, [active.lane, active.solanaAddress, active.address]);

  const mintOf = useCallback(async (wrapper: Hex): Promise<PublicKey> => {
    if (!publicClient) throw new Error("Chain not ready");
    const mintId = (await publicClient.readContract({ address: wrapper, abi: SPL_WRAPPER_PROBE_ABI, functionName: "mint_id" })) as Hex;
    return new PublicKey(hexToBytes(mintId));
  }, [publicClient]);

  const syntheticBalance = useCallback(async (wrapper: Hex): Promise<bigint> => {
    const { synthetic } = requireSolana();
    if (!publicClient) throw new Error("Chain not ready");
    return (await publicClient.readContract({ address: wrapper, abi: Erc20Abi, functionName: "balanceOf", args: [synthetic] })) as bigint;
  }, [publicClient, requireSolana]);

  const walletBalance = useCallback(async (wrapper: Hex): Promise<bigint> => {
    const { wallet } = requireSolana();
    const [side] = await readWalletSide(connection, wallet, [await mintOf(wrapper)]);
    return side!;
  }, [connection, mintOf, requireSolana]);

  const fund = useCallback(async (wrapper: Hex, tokens: bigint): Promise<string> => {
    const { wallet, synthetic } = requireSolana();
    const mint = await mintOf(wrapper);
    let wrapMissing = 0n;
    if (isNativeMint(mint)) {
      // The wSOL account may hold less than needed; the same transaction tops it up from plain SOL.
      const info = await connection.getAccountInfo(associatedTokenAddress(mint, wallet), "confirmed");
      const held = tokenAmountOf(info?.data);
      wrapMissing = tokens > held ? tokens - held : 0n;
    }
    const ixs = buildFundInstructions({ programId, chainId: hadrianChain.chainId, mint, tokens, wallet, synthetic, wrapMissing });
    return sendNativeV1(ixs, laneSigner(), { solanaRpcUrl: SOLANA_RPC });
  }, [connection, laneSigner, mintOf, programId, requireSolana]);

  const sweepAll = useCallback(async (wrapper: Hex): Promise<SweepResult> => {
    const { wallet, synthetic } = requireSolana();
    const tokens = await syntheticBalance(wrapper);
    if (tokens === 0n) return { evmTxHash: null, tokens, closeSignature: null };
    if (!publicClient) throw new Error("Chain not ready");
    const mint = await mintOf(wrapper);
    const leg = buildSweepLeg({ programId, chainId: hadrianChain.chainId, mint, tokens, wallet, synthetic });
    // The wallet's own ATA must exist before transfer_spl lands into it (idempotent; skipped when it does).
    const ataInfo = await connection.getAccountInfo(leg.walletAta, "confirmed");
    if (!ataInfo) await sendNativeV1([leg.ensureWalletAtaIx], laneSigner(), { solanaRpcUrl: SOLANA_RPC });
    const evmTxHash = await sendRaw(leg.call);
    await requireSuccess(publicClient, evmTxHash, wasRelayed(evmTxHash), { linkInMessage: true });
    // Native SOL: close the wSOL account so the user holds plain SOL, not a wrapped token.
    const closeSignature = leg.closeWalletAtaIx ? await sendNativeV1([leg.closeWalletAtaIx], laneSigner(), { solanaRpcUrl: SOLANA_RPC }) : null;
    return { evmTxHash, tokens, closeSignature };
  }, [connection, laneSigner, mintOf, programId, publicClient, requireSolana, sendRaw, syntheticBalance, wasRelayed]);

  return { syntheticBalance, walletBalance, fund, sweepAll };
}
