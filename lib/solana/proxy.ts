// The Rome proxy's external-V1 surface (rome-apps proxy/src/api/mod.rs) and
// the few eth_* reads the lane needs, as plain JSON-RPC over fetch. Every
// compose/relay call carries the wallet's AUTH signature; the proxy verifies it
// before answering (a wrong one answers `PrecompileError: signature is not valid`).
import { base58 } from "@scure/base";
import type { PublicKey } from "@solana/web3.js";
import type { Hex } from "viem";

export type FetchLike = typeof fetch;

export interface JsonRpcError extends Error { code?: number; data?: unknown }

export async function jsonRpc<T>(url: string, method: string, params: unknown[], fetchImpl: FetchLike = fetch): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
  if (json.error) {
    const e = new Error(`${method}: ${json.error.message}${json.error.data ? ` (${typeof json.error.data === "string" ? json.error.data : JSON.stringify(json.error.data)})` : ""}`) as JsonRpcError;
    e.code = json.error.code; e.data = json.error.data;
    throw e;
  }
  if (json.result === undefined) throw new Error(`${method}: empty result`);
  return json.result;
}

export interface AtomicUnsignedV1Plan { recentBlockhash: string; transaction: string }
export interface UnsignedV1Plan { recentBlockhash: string; transactions: string[] }

export const ATOMIC_REQUIRES_ITERATIVE = "external atomic plan requires iterative composition";

export function composeUnsignedAtomicV1(proxyUrl: string, rlp: Hex, payer: PublicKey, authSig: Uint8Array, f?: FetchLike) {
  return jsonRpc<AtomicUnsignedV1Plan>(proxyUrl, "rome_composeUnsignedAtomicV1", [rlp, payer.toBase58(), base58.encode(authSig)], f);
}
export function composeUnsignedIterativeV1(proxyUrl: string, rlp: Hex, payer: PublicKey, authSig: Uint8Array, f?: FetchLike) {
  return jsonRpc<UnsignedV1Plan>(proxyUrl, "rome_composeUnsignedIterativeV1", [rlp, payer.toBase58(), base58.encode(authSig)], f);
}
export function submitSignedV1Plan(proxyUrl: string, payer: PublicKey, signedWiresBase64: string[], f?: FetchLike) {
  return jsonRpc<string[]>(proxyUrl, "rome_submitSignedV1Plan", [payer.toBase58(), signedWiresBase64], f);
}
/** Proxy payer runs the (possibly iterative) execution; the synthetic pays EVM gas from its native balance. Returns the EVM tx hash. */
export function relayUnsignedV1(proxyUrl: string, rlp: Hex, payer: PublicKey, authSig: Uint8Array, f?: FetchLike) {
  return jsonRpc<Hex>(proxyUrl, "rome_relayUnsignedV1", [rlp, payer.toBase58(), base58.encode(authSig)], f);
}
/** One wallet-signed V1 that funds the synthetic's native gas balance (needed before relayUnsignedV1). */
export function composeExternalDepositV1(proxyUrl: string, payer: PublicKey, amountWei: bigint, f?: FetchLike) {
  return jsonRpc<AtomicUnsignedV1Plan>(proxyUrl, "rome_composeExternalDepositV1", [payer.toBase58(), `0x${amountWei.toString(16)}`], f);
}

export const ethRpc = {
  nonce: async (proxyUrl: string, address: Hex, f?: FetchLike) => BigInt(await jsonRpc<Hex>(proxyUrl, "eth_getTransactionCount", [address, "pending"], f)),
  gasPrice: async (proxyUrl: string, f?: FetchLike) => BigInt(await jsonRpc<Hex>(proxyUrl, "eth_gasPrice", [], f)),
  estimateGas: async (proxyUrl: string, call: { from: Hex; to: Hex; data: Hex; value?: bigint }, f?: FetchLike) =>
    BigInt(await jsonRpc<Hex>(proxyUrl, "eth_estimateGas", [{ from: call.from, to: call.to, data: call.data, ...(call.value ? { value: `0x${call.value.toString(16)}` } : {}) }], f)),
  balance: async (proxyUrl: string, address: Hex, f?: FetchLike) => BigInt(await jsonRpc<Hex>(proxyUrl, "eth_getBalance", [address, "latest"], f)),
};
