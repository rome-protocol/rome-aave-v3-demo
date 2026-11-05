// Atomic send over the Solana lane: compose (proxy) → sign twice (wallet) →
// broadcast to the Solana RPC (never the proxy) → confirm → read CU at tx
// version 1. Address lookup tables and legacy transactions are not used.
import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { concatHex, keccak256, type Hex } from "viem";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { ATOMIC_REQUIRES_ITERATIVE, composeUnsignedAtomicV1, jsonRpc, type FetchLike } from "./proxy";

/** The proxy refused an atomic composition; carries the auth signature already obtained so the iterative paths can reuse it. */
export class AtomicRefused extends Error {
  constructor(public readonly authSig: Uint8Array) { super(ATOMIC_REQUIRES_ITERATIVE); this.name = "AtomicRefused"; }
}
import { accountsForProgram, parseV1Message, splitV1Wire } from "./v1Message";

/** keccak256(0x02 ‖ rlp): the typed-tx hash of the unsigned EIP-1559 body — what the authorisation commits to. */
export function authHashFor(unsignedRlp: Hex): Uint8Array {
  return keccak256(concatHex(["0x02", unsignedRlp]), "bytes");
}
/** The readable form the program accepts (rome-evm config::ED25519_AUTH_MESSAGE_PREFIX): prefix + 64 lowercase hex chars = 85 bytes. */
export const AUTH_MESSAGE_PREFIX = "Rome authorization\n0x";
/**
 * What the wallet is asked to sign: a sentence a person can read in the
 * prompt, ending in the hash the program recomputes from the body it runs.
 * The proxy verifies the signature over exactly these bytes and puts them in
 * the Ed25519 verifier instruction; the program accepts this form or the raw
 * 32-byte hash, nothing else.
 */
export function authMessageFor(unsignedRlp: Hex): Uint8Array {
  return new Uint8Array(Buffer.from(AUTH_MESSAGE_PREFIX + Buffer.from(authHashFor(unsignedRlp)).toString("hex"), "utf8"));
}
export function isAuthMessage(bytes: Uint8Array): boolean {
  if (bytes.length !== AUTH_MESSAGE_PREFIX.length + 64) return false;
  const text = Buffer.from(bytes).toString("utf8");
  return text.startsWith(AUTH_MESSAGE_PREFIX) && /^[0-9a-f]{64}$/.test(text.slice(AUTH_MESSAGE_PREFIX.length));
}
/** The EVM transaction hash the proxy and explorer will show for this send — the same bytes as the auth hash. */
export function evmTxHashOf(unsignedRlp: Hex): Hex {
  return keccak256(concatHex(["0x02", unsignedRlp]));
}

export interface SolanaRpcDeps {
  solanaRpcUrl: string;
  fetchImpl?: FetchLike;
}

export interface AtomicSendDeps extends SolanaRpcDeps {
  proxyUrl: string;
  programId: PublicKey;
  /** Poll interval for confirmation (ms). */
  pollMs?: number;
  onSigned?: (which: "auth" | "transaction") => void;
}

export interface AtomicSendResult {
  signature: string;
  evmTxHash: Hex;
  computeUnitsConsumed: number | null;
  wireBytes: number;
  accounts: number;
}

interface RawMeta { computeUnitsConsumed?: number; logMessages?: string[]; err?: unknown }

/** getTransaction at version 1 via raw JSON-RPC — web3.js 1.x cannot decode a v1 tx and would report 0 CU. */
export async function getTransactionMetaRaw(solanaRpcUrl: string, signature: string, f: FetchLike = fetch): Promise<RawMeta | null> {
  try {
    const r = await jsonRpc<{ meta?: RawMeta | null } | null>(solanaRpcUrl, "getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 1 }], f);
    return r?.meta ?? null;
  } catch {
    return null;
  }
}

export async function pollConfirmation(solanaRpcUrl: string, signature: string, lastValidBlockHeight: number, pollMs = 1500, f: FetchLike = fetch): Promise<unknown | null> {
  for (;;) {
    const { value } = await jsonRpc<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>(solanaRpcUrl, "getSignatureStatuses", [[signature], { searchTransactionHistory: true }], f);
    const st = value[0];
    if (st) {
      if (st.err) return st.err;
      if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return null;
    }
    const height = await jsonRpc<number>(solanaRpcUrl, "getBlockHeight", [{ commitment: "confirmed" }], f);
    if (height > lastValidBlockHeight) throw new Error("The transaction was not confirmed before its blockhash expired.");
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Compose + sign + send ONE atomic v1 transaction for `unsignedRlp`.
 * Throws the proxy's own message when the call cannot be atomic
 * (`ATOMIC_REQUIRES_ITERATIVE`), so the caller can take the relay path.
 */
export async function submitAtomicV1(unsignedRlp: Hex, signer: LaneSigner, deps: AtomicSendDeps): Promise<AtomicSendResult> {
  const f = deps.fetchImpl ?? fetch;
  // Signature 1 of 2: the compose-time AUTH signature over the readable envelope.
  const authSig = await signer.signAuthMessage(authMessageFor(unsignedRlp));
  deps.onSigned?.("auth");
  let plan;
  try {
    plan = await composeUnsignedAtomicV1(deps.proxyUrl, unsignedRlp, signer.payer, authSig, f);
  } catch (e) {
    if (e instanceof Error && e.message.includes(ATOMIC_REQUIRES_ITERATIVE)) throw new AtomicRefused(authSig);
    throw e;
  }

  const wire = new Uint8Array(Buffer.from(plan.transaction, "base64"));
  const { message, numRequiredSignatures } = splitV1Wire(wire);
  if (numRequiredSignatures !== 1) throw new Error(`The composed transaction needs ${numRequiredSignatures} signatures; this lane signs for one payer only.`);
  // VALIDATE BEFORE ASKING FOR A SIGNATURE: a malformed or unknown-mask answer throws here, never after a human approved it.
  const parsed = parseV1Message(message);
  if (!parsed.accountKeys[0]?.equals(signer.payer)) throw new Error("The composed transaction's fee payer is not the connected wallet; refusing to sign it.");
  const romeAccounts = accountsForProgram(parsed, deps.programId);
  if (!romeAccounts) throw new Error("The composed transaction carries no Rome instruction; refusing to sign it.");

  // Signature 2 of 2: the TRANSACTION signature over the wire (message ‖ zero slot).
  const txSig = await signer.signV1Wire(wire);
  deps.onSigned?.("transaction");
  const signedWire = Buffer.concat([Buffer.from(message), Buffer.from(txSig)]);

  // Only a clock for the poll's expiry check — the message's own blockhash (chosen by the proxy) is what the network validates.
  const { value: bh } = await jsonRpc<{ value: { lastValidBlockHeight: number } }>(deps.solanaRpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }], f);
  const signature = await jsonRpc<string>(deps.solanaRpcUrl, "sendTransaction", [signedWire.toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }], f);
  const err = await pollConfirmation(deps.solanaRpcUrl, signature, bh.lastValidBlockHeight, deps.pollMs, f);
  const meta = await getTransactionMetaRaw(deps.solanaRpcUrl, signature, f);
  if (err) {
    const logs = meta?.logMessages?.join("\n");
    throw new Error(`The transaction landed but failed: ${JSON.stringify(err)}${logs ? `\n${logs}` : ""}`);
  }
  return {
    signature,
    evmTxHash: evmTxHashOf(unsignedRlp),
    computeUnitsConsumed: meta?.computeUnitsConsumed ?? null,
    wireBytes: wire.length,
    accounts: romeAccounts.length,
  };
}
