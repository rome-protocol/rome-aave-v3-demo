// A factory ≥8.0.0 SPL wrapper moves the underlying SPL as the HOLDER's
// delegate, so every holder — an EVM wallet or a Solana wallet's synthetic —
// must once sign `HelperProgram.approve_spl(wrapper, max, mint)` to the helper
// precompile, or the wrapper's transferFrom reverts with a full ERC-20
// allowance in place. Probe: `wrapper.isEnabled(holder)`. Ported from the Rome web app
// src/lib/wrapperGrant.ts (same selector 0xabf6f675).
import { PublicKey } from "@solana/web3.js";
import { encodeFunctionData, hexToBytes, type Hex } from "viem";

export const HELPER_PRECOMPILE_ADDRESS: Hex = "0xff00000000000000000000000000000000000009";
export const APPROVE_SPL_SELECTOR = "0xabf6f675";
export const MAX_SPL_ALLOWANCE = 18446744073709551615n;

export const APPROVE_SPL_ABI = [
  { type: "function", name: "approve_spl", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint64" }, { name: "mint", type: "bytes32" }], outputs: [] },
] as const;
export const SPL_WRAPPER_PROBE_ABI = [
  { type: "function", name: "isEnabled", stateMutability: "view", inputs: [{ name: "user", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "mint_id", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "bytes32" }] },
] as const;

export function mintIdToBase58(mintId: Hex): string {
  return new PublicKey(hexToBytes(mintId)).toBase58();
}

export function encodeApproveSplGrant(input: { wrapper: Hex; mintId: Hex; amount?: bigint }): { to: Hex; data: Hex } {
  if (hexToBytes(input.mintId).length !== 32) throw new Error(`mintId is not a 32-byte key: ${input.mintId}`);
  return {
    to: HELPER_PRECOMPILE_ADDRESS,
    data: encodeFunctionData({ abi: APPROVE_SPL_ABI, functionName: "approve_spl", args: [input.wrapper, input.amount ?? MAX_SPL_ALLOWANCE, input.mintId] }),
  };
}
