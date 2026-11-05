// Native (non-Rome-EVM) wallet transactions, sent as SIMD-0385 v1 like every
// other Solana send in this lane: encode the message, one wallet signature over
// the wire (the LaneSigner's v1 seam), broadcast to the Solana RPC, confirm.
import { Buffer } from "buffer";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { jsonRpc, type FetchLike } from "./proxy";
import { pollConfirmation } from "./submit";
import { encodeV1Message } from "./v1Message";

export async function sendNativeV1(
  instructions: readonly TransactionInstruction[],
  signer: LaneSigner,
  deps: { solanaRpcUrl: string; fetchImpl?: FetchLike },
): Promise<string> {
  const f = deps.fetchImpl ?? fetch;
  const { value: bh } = await jsonRpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>(deps.solanaRpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }], f);
  const message = encodeV1Message({ payer: signer.payer, recentBlockhash: new PublicKey(bh.blockhash).toBytes(), instructions });
  const wire = new Uint8Array(message.length + 64); // message ‖ one zero signature slot
  wire.set(message);
  const sig = await signer.signV1Wire(wire);
  const signed = Buffer.concat([Buffer.from(message), Buffer.from(sig)]);
  const signature = await jsonRpc<string>(deps.solanaRpcUrl, "sendTransaction", [signed.toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }], f);
  const err = await pollConfirmation(deps.solanaRpcUrl, signature, bh.lastValidBlockHeight, undefined, f);
  if (err) throw new Error(`The transaction landed but failed: ${JSON.stringify(err)}`);
  return signature;
}
