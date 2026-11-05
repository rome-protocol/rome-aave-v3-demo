// The relayed path, for a call the atomic composer refuses ("requires
// iterative composition"): the wallet signs ONLY the authorisation hash, the
// proxy's payer runs every leg, and the SYNTHETIC pays the EVM gas in wei from
// its own native balance. That balance is funded by one wallet-signed v1
// deposit (rome_composeExternalDepositV1): the wallet's gas-token SPL (USDC on
// Hadrian) moves to the chain and the synthetic is credited the same value.
import { Buffer } from "buffer";
import { parseTransaction, type Hex } from "viem";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { syntheticAddress } from "@/lib/lane/identity";
import { composeExternalDepositV1, ethRpc, jsonRpc, relayUnsignedV1, type FetchLike } from "./proxy";
import { authMessageFor, evmTxHashOf, getTransactionMetaRaw, pollConfirmation, type AtomicSendDeps } from "./submit";
import { parseV1Message, splitV1Wire } from "./v1Message";

/** Worst-case wei the relayed execution can charge the synthetic: gasLimit × maxFeePerGas of the body. */
export function maxGasCostWei(unsignedRlp: Hex): bigint {
  const tx = parseTransaction(`0x02${unsignedRlp.slice(2)}` as Hex);
  if (tx.gas === undefined || tx.maxFeePerGas === undefined) throw new Error("maxGasCostWei: the body carries no gas limit or fee");
  return tx.gas * tx.maxFeePerGas;
}

export interface RelayDeps extends AtomicSendDeps {
  onPhase?: (phase: "depositing" | "relaying") => void;
  /** Receipt wait after the relay returns: attempts × interval (default 40 × 1500 ms). */
  receiptTries?: number;
  receiptMs?: number;
}

/**
 * Make sure the synthetic can pay `neededWei` of gas; when it cannot, one
 * wallet-signed v1 deposit tops it up by the shortfall (rounded up to whole
 * gas-token units the chain can move). Resolves to the deposit's Solana
 * signature, or null when nothing was needed.
 */
export async function ensureSyntheticGas(neededWei: bigint, signer: LaneSigner, deps: RelayDeps): Promise<string | null> {
  const f = deps.fetchImpl ?? fetch;
  const synthetic = syntheticAddress(signer.payer);
  const balance = await ethRpc.balance(deps.proxyUrl, synthetic, f);
  if (balance >= neededWei) return null;
  // The chain moves the gas token in its own base units (6 decimals for USDC);
  // wei below 1e12 cannot be represented, so round the shortfall up to that.
  const UNIT = 1_000_000_000_000n;
  const shortfall = neededWei - balance;
  const topUp = ((shortfall + UNIT - 1n) / UNIT) * UNIT;
  deps.onPhase?.("depositing");
  const plan = await composeExternalDepositV1(deps.proxyUrl, signer.payer, topUp, f);
  const wire = new Uint8Array(Buffer.from(plan.transaction, "base64"));
  const { message, numRequiredSignatures } = splitV1Wire(wire);
  if (numRequiredSignatures !== 1) throw new Error(`The deposit needs ${numRequiredSignatures} signatures; this lane signs for one payer only.`);
  const parsed = parseV1Message(message);
  if (!parsed.accountKeys[0]?.equals(signer.payer)) throw new Error("The deposit's fee payer is not the connected wallet; refusing to sign it.");
  if (!parsed.instructions.some((ix) => parsed.accountKeys[ix.programIdIndex]?.equals(deps.programId))) throw new Error("The deposit carries no Rome instruction; refusing to sign it.");
  const sig = await signer.signV1Wire(wire);
  const signed = Buffer.concat([Buffer.from(message), Buffer.from(sig)]);
  const { value: bh } = await jsonRpc<{ value: { lastValidBlockHeight: number } }>(deps.solanaRpcUrl, "getLatestBlockhash", [{ commitment: "confirmed" }], f);
  const signature = await jsonRpc<string>(deps.solanaRpcUrl, "sendTransaction", [signed.toString("base64"), { encoding: "base64", preflightCommitment: "confirmed" }], f);
  const err = await pollConfirmation(deps.solanaRpcUrl, signature, bh.lastValidBlockHeight, deps.pollMs, f);
  if (err) {
    const meta = await getTransactionMetaRaw(deps.solanaRpcUrl, signature, f);
    throw new Error(`The deposit landed but failed: ${JSON.stringify(err)}${meta?.logMessages ? `\n${meta.logMessages.join("\n")}` : ""}`);
  }
  // The EVM view lags Solana confirmation; wait until the balance shows the credit.
  for (let i = 0; i < 20; i++) {
    if ((await ethRpc.balance(deps.proxyUrl, synthetic, f)) >= neededWei) return signature;
    await new Promise((r) => setTimeout(r, deps.pollMs ?? 1500));
  }
  throw new Error(`The deposit confirmed (${signature}) but the balance has not been credited yet; try again in a moment.`);
}

export interface RelayResult { evmTxHash: Hex; depositSignature: string | null }

/** Relay `unsignedRlp` through the proxy: one auth prompt (plus the deposit, when the synthetic cannot pay). */
export async function sendRelayed(unsignedRlp: Hex, signer: LaneSigner, deps: RelayDeps, authSigGiven?: Uint8Array): Promise<RelayResult> {
  const f = deps.fetchImpl ?? fetch;
  const depositSignature = await ensureSyntheticGas(maxGasCostWei(unsignedRlp), signer, deps);
  deps.onPhase?.("relaying");
  const authSig = authSigGiven ?? await signer.signAuthMessage(authMessageFor(unsignedRlp));
  if (!authSigGiven) deps.onSigned?.("auth");
  const returned = await relayUnsignedV1(deps.proxyUrl, unsignedRlp, signer.payer, authSig, f);
  const expected = evmTxHashOf(unsignedRlp);
  if (returned.toLowerCase() !== expected.toLowerCase()) throw new Error(`The proxy relayed a different transaction (${returned}) than the one signed (${expected}).`);
  return { evmTxHash: expected, depositSignature };
}
