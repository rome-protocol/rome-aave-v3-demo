// The DIRECT path for a call the atomic composer refuses: the proxy composes
// every leg (rome_composeUnsignedIterativeV1), the wallet signs ALL legs in ONE
// prompt (Wallet Standard signTransaction takes several inputs), and the app
// broadcasts the legs to Solana itself, in order, exactly like the atomic
// path. No proxy payer, no synthetic gas, the wallet stays the fee payer.
// Every leg is validated BEFORE the wallet is asked, and every returned
// signature is verified over the unaltered message BEFORE anything is sent.
import { Buffer } from "buffer";
import { ed25519 } from "@noble/curves/ed25519";
import type { Hex } from "viem";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { syntheticAddress } from "@/lib/lane/identity";
import { composeUnsignedIterativeV1, jsonRpc } from "./proxy";
import { evmTxHashOf, getTransactionMetaRaw, type AtomicSendDeps } from "./submit";
import { accountsForProgram, parseV1Message, splitV1Wire } from "./v1Message";

/** The wallet would not (or could not) sign the batch: the caller may take the relayed path instead. */
export class PlanSigningRefused extends Error {
  constructor(message: string, public readonly legs: number) { super(message); this.name = "PlanSigningRefused"; }
}

export interface PlanDeps extends AtomicSendDeps {
  chainId: number;
  onPhase?: (phase: "signing-plan" | "sending-plan") => void;
  onLegLanded?: (index: number, total: number, signature: string) => void;
}

export interface PlanResult { evmTxHash: Hex; legs: number; signatures: string[]; /** legs the network refused at send (tolerated when the session completed). */ legErrors: string[] }

export async function sendSignedPlan(unsignedRlp: Hex, authSig: Uint8Array, signer: LaneSigner, deps: PlanDeps): Promise<PlanResult> {
  const f = deps.fetchImpl ?? fetch;
  const plan = await composeUnsignedIterativeV1(deps.proxyUrl, unsignedRlp, signer.payer, authSig, f);
  const wires = plan.transactions.map((t) => new Uint8Array(Buffer.from(t, "base64")));
  if (wires.length === 0) throw new Error("The proxy composed an empty plan.");
  // Validate every leg before the wallet sees any of them.
  const messages = wires.map((wire, i) => {
    const { message, numRequiredSignatures } = splitV1Wire(wire);
    if (numRequiredSignatures !== 1) throw new Error(`leg ${i + 1}: needs ${numRequiredSignatures} signatures; this lane signs for one payer only.`);
    const parsed = parseV1Message(message);
    if (!parsed.accountKeys[0]?.equals(signer.payer)) throw new Error(`leg ${i + 1}: fee payer is not the connected wallet; refusing to sign it.`);
    if (!accountsForProgram(parsed, deps.programId)) throw new Error(`leg ${i + 1}: carries no Rome instruction; refusing to sign it.`);
    return message;
  });
  if (!signer.signV1Wires) throw new PlanSigningRefused("This wallet cannot sign several transactions in one prompt.", wires.length);
  deps.onPhase?.("signing-plan");
  let sigs: Uint8Array[];
  try {
    sigs = await signer.signV1Wires(wires);
  } catch (e) {
    throw new PlanSigningRefused(`The wallet did not sign the ${wires.length}-step plan: ${e instanceof Error ? e.message : String(e)}`, wires.length);
  }
  if (sigs.length !== wires.length) throw new PlanSigningRefused(`The wallet returned ${sigs.length} signatures for ${wires.length} steps.`, wires.length);
  const signed = messages.map((message, i) => {
    const sig = sigs[i]!;
    if (sig.length !== 64 || !ed25519.verify(sig, message, signer.payer.toBytes())) throw new Error(`leg ${i + 1}: the wallet's signature does not verify over the composed message; refusing to send it.`);
    return Buffer.concat([Buffer.from(message), Buffer.from(sig)]);
  });
  // Broadcast every leg AT ONCE, exactly as the proxy's tower does (parallel,
  // unchecked): the legs are blind-fired steps of one iterative session, so
  // order does not matter and a leg that arrives after the session finished
  // simply no-ops or is rejected. Success is the SESSION completing — the
  // synthetic's nonce advancing — not every leg landing.
  deps.onPhase?.("sending-plan");
  const synthetic = syntheticAddress(signer.payer);
  const nonceBefore = await jsonRpc<Hex>(deps.proxyUrl, "eth_getTransactionCount", [synthetic, "latest"], f).then((h) => BigInt(h)).catch(() => 0n);
  const { value: bh } = await jsonRpc<{ value: { lastValidBlockHeight: number } }>(deps.solanaRpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }], f);
  const sent = await Promise.all(signed.map(async (wire, i) => {
    try {
      const signature = await jsonRpc<string>(deps.solanaRpcUrl, "sendTransaction", [wire.toString("base64"), { encoding: "base64", preflightCommitment: "confirmed", skipPreflight: true }], f);
      return { i, signature };
    } catch (e) {
      return { i, error: e instanceof Error ? e.message : String(e) };
    }
  }));
  const signatures = sent.filter((r) => r.signature).map((r) => r.signature!);
  const legErrors = sent.filter((r) => r.error).map((r) => `leg ${r.i + 1}: ${r.error}`);
  sent.forEach((r) => { if (r.signature) deps.onLegLanded?.(r.i + 1, signed.length, r.signature); });
  if (signatures.length === 0) throw new Error(`No leg was accepted by the network:\n${legErrors.join("\n")}`);
  // Wait for the session to complete (nonce advance), bounded by the blockhash lifetime.
  const pollMs = deps.pollMs ?? 1500;
  for (;;) {
    const nonce = await jsonRpc<Hex>(deps.proxyUrl, "eth_getTransactionCount", [synthetic, "latest"], f).then((h) => BigInt(h)).catch(() => nonceBefore);
    if (nonce > nonceBefore) break;
    const height = await jsonRpc<number>(deps.solanaRpcUrl, "getBlockHeight", [{ commitment: "confirmed" }], f);
    if (height > bh.lastValidBlockHeight) {
      // Gather what the chain said about the legs that were accepted.
      const { value } = await jsonRpc<{ value: ({ err: unknown } | null)[] }>(deps.solanaRpcUrl, "getSignatureStatuses", [signatures, { searchTransactionHistory: true }], f).catch(() => ({ value: [] as ({ err: unknown } | null)[] }));
      const chainErrs: string[] = [];
      for (const [k, st] of value.entries()) if (st?.err) { const meta = await getTransactionMetaRaw(deps.solanaRpcUrl, signatures[k]!, f); chainErrs.push(`${signatures[k]!.slice(0, 12)}: ${JSON.stringify(st.err)}${meta?.logMessages ? ` — ${meta.logMessages.filter((l) => /Error|failed|log:/i.test(l)).slice(-2).join(" | ")}` : ""}`); }
      throw new Error(`The ${signed.length}-step plan did not complete before its blockhash expired.\n${[...legErrors, ...chainErrs].join("\n") || "no leg reported an error"}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { evmTxHash: evmTxHashOf(unsignedRlp), legs: signed.length, signatures, legErrors };
}
