"use client";

// ONE send function for both lanes. The EVM wallet's path is what the hooks
// did before (estimate ×1.3, wagmi writeContract). The Solana wallet's path
// encodes the same call, and sends it as an atomic SIMD-0385 v1 transaction
// composed by the proxy and signed twice by the wallet (lib/solana/laneCall.ts).
// Both resolve to the EVM transaction hash the explorer shows.
//
// A call the atomic composer refuses ("requires iterative composition") takes
// the RELAYED path (lib/solana/relay.ts) — atomic
// goes through with the Solana user as payer; iterative goes through the
// relay. The synthetic's gas balance is topped up by one wallet-signed deposit
// when short, then the auth signature already given lets the proxy's payer run
// every leg. (The wallet-signed plan, lib/solana/plan.ts, stays available and
// proven, but is not on the app's path: wallets' batch prompts are not
// reliable on devnet.) Iterative hashes are remembered so callers re-read state
// on the nonce advance rather than wait on a receipt.

import { useCallback, useRef } from "react";
import { usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { encodeFunctionData, type Abi, type Hex } from "viem";
import { PublicKey } from "@solana/web3.js";
import { hadrian } from "@/lib/wagmi";
import { getChain, DEFAULT_CHAIN_ID } from "@/lib/registry-config";
import hadrianChain from "@/lib/hadrian-chain.json";
import { useActiveLane } from "@/hooks/useActiveLane";
import { useLaneSigner } from "@/hooks/useLaneSigner";
import { sendSolanaLaneCall, waitForNonceAdvance, NeedsIterativeError } from "@/lib/solana/laneCall";
import { sendRelayed } from "@/lib/solana/relay";
import { authMessageFor } from "@/lib/solana/submit";
import { ethRpc } from "@/lib/solana/proxy";
import { encodeApproveSplGrant, SPL_WRAPPER_PROBE_ABI } from "@/lib/wrapperGrant";

export interface ContractCall {
  address: Hex;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  value?: bigint;
}

export type LanePhase = "depositing" | "relaying";
export interface SendHooks { onSigned?: (which: "auth" | "transaction") => void; onPhase?: (phase: LanePhase) => void }

export interface SendAaveCall {
  /** The lane the send will take (null = nothing connected / undecided). */
  lane: "evm" | "solana" | null;
  /** Sends a contract call on the active lane; resolves to the EVM tx hash. */
  sendCall: (call: ContractCall, hooks?: SendHooks) => Promise<Hex>;
  /** Sends a raw {to,data} call on the active lane; resolves to the EVM tx hash. */
  sendRaw: (call: { to: Hex; data: Hex; value?: bigint }, hooks?: SendHooks) => Promise<Hex>;
  /** True when `hash` came from an ITERATIVE send (direct plan or relay): no receipt is served under it yet; state is already final. */
  wasRelayed: (hash: Hex) => boolean;
  /** Grants the wrapper its one-time SPL delegate for the active address when missing. Resolves to the tx hash, or null when already enabled. */
  ensureWrapperGrant: (wrapper: Hex) => Promise<Hex | null>;
}

export { NeedsIterativeError };

export function useSendAaveCall(): SendAaveCall {
  const active = useActiveLane();
  const publicClient = usePublicClient({ chainId: hadrian.id });
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const laneSigner = useLaneSigner();
  const relayed = useRef(new Set<string>());


  const solanaDeps = useCallback(() => ({
    proxyUrl: "/api/rome-rpc",
    solanaRpcUrl: "/api/solana-rpc",
    programId: new PublicKey(hadrianChain.romeEvmProgramId),
    chainId: getChain(DEFAULT_CHAIN_ID)?.chainId ?? hadrian.id,
  }), []);

  /** Solana lane: atomic first; when the proxy refuses, the relayed path. */
  const sendOnLane = useCallback(async (call: { to: Hex; data: Hex; value?: bigint }, hooks?: SendHooks): Promise<Hex> => {
    const signer = laneSigner();
    const deps = { ...solanaDeps(), onSigned: hooks?.onSigned };
    try {
      return (await sendSolanaLaneCall(call, signer, deps)).evmTxHash;
    } catch (e) {
      if (!(e instanceof NeedsIterativeError)) throw e;
      // The auth signature from the atomic attempt covers the same body — reuse it, never prompt twice.
      const authSig = e.authSig ?? await signer.signAuthMessage(authMessageFor(e.rlp));
      const before = await ethRpc.nonce(deps.proxyUrl, e.synthetic);
      const r = await sendRelayed(e.rlp, signer, { ...deps, onPhase: hooks?.onPhase }, authSig);
      // the relay returns after the legs land; the EVM view may still lag a moment
      await waitForNonceAdvance(deps.proxyUrl, e.synthetic, before - 1n);
      relayed.current.add(r.evmTxHash.toLowerCase());
      return r.evmTxHash;
    }
  }, [laneSigner, solanaDeps]);

  const sendRaw = useCallback(async (call: { to: Hex; data: Hex; value?: bigint }, hooks?: SendHooks): Promise<Hex> => {
    if (active.lane === "evm") {
      return sendTransactionAsync({ to: call.to, data: call.data, value: call.value, chainId: hadrian.id });
    }
    if (active.lane === "solana") return sendOnLane(call, hooks);
    throw new Error("Connect a wallet first.");
  }, [active.lane, sendTransactionAsync, sendOnLane]);

  const sendCall = useCallback(async (call: ContractCall, hooks?: SendHooks): Promise<Hex> => {
    if (!active.address || !publicClient) throw new Error("Connect a wallet first.");
    if (active.lane === "evm") {
      const est = await publicClient.estimateContractGas({ account: active.address, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args as unknown[], value: call.value });
      return writeContractAsync({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args as unknown[], value: call.value, chainId: hadrian.id, gas: (est * 13_000n) / 10_000n });
    }
    if (active.lane === "solana") {
      const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args as unknown[] });
      return sendOnLane({ to: call.address, data, value: call.value }, hooks);
    }
    throw new Error("Connect a wallet first.");
  }, [active.address, active.lane, publicClient, writeContractAsync, sendOnLane]);

  const ensureWrapperGrant = useCallback(async (wrapper: Hex): Promise<Hex | null> => {
    if (!active.address || !publicClient) throw new Error("Connect a wallet first.");
    let enabled: boolean | undefined;
    try {
      enabled = (await publicClient.readContract({ address: wrapper, abi: SPL_WRAPPER_PROBE_ABI, functionName: "isEnabled", args: [active.address] })) as boolean;
    } catch {
      enabled = undefined; // no probe → not a delegate-style wrapper (or a transient read failure): grant is idempotent, so grant.
    }
    if (enabled === true) return null;
    let mintId: Hex;
    try {
      mintId = (await publicClient.readContract({ address: wrapper, abi: SPL_WRAPPER_PROBE_ABI, functionName: "mint_id" })) as Hex;
    } catch {
      return null; // no mint_id → a plain ERC-20, nothing to grant
    }
    return sendRaw(encodeApproveSplGrant({ wrapper, mintId }));
  }, [active.address, publicClient, sendRaw]);

  const wasRelayed = useCallback((hash: Hex) => relayed.current.has(hash.toLowerCase()), []);

  return { lane: active.lane, sendCall, sendRaw, ensureWrapperGrant, wasRelayed };
}
