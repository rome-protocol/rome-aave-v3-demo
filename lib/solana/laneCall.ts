// One EVM call, sent from a Solana wallet: nonce / gas price / gas estimate are
// read for the SYNTHETIC sender, the bare EIP-1559 body is built, and the
// atomic v1 path is taken. When the proxy answers that the call cannot be
// atomic, `NeedsIterativeError` is thrown so the caller can offer the relay.
import type { Hex } from "viem";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { syntheticAddress } from "@/lib/lane/identity";
import { ATOMIC_REQUIRES_ITERATIVE, ethRpc, type FetchLike } from "./proxy";
import { AtomicRefused, submitAtomicV1, type AtomicSendDeps, type AtomicSendResult } from "./submit";
import { buildUnsignedEip1559Rlp } from "./unsignedTx";

/** Gas headroom over the proxy's estimate: ×1.2 (Bloom's GAS_HEADROOM_NUMERATOR). */
const GAS_HEADROOM_NUMERATOR = 12n;

export interface EvmCall { to: Hex; data: Hex; value?: bigint }

export interface LaneCallDeps extends AtomicSendDeps {
  chainId: number;
  /** Nonce-advance wait after Solana confirmation: attempts × interval (default 20 × 1500 ms). */
  nonceWaitTries?: number;
  nonceWaitMs?: number;
}

export class NeedsIterativeError extends Error {
  /** `authSig` is the wallet's signature over authMessageFor(rlp), already given for the atomic attempt — reuse it, do not prompt again. */
  constructor(public readonly rlp: Hex, public readonly synthetic: Hex, public readonly authSig?: Uint8Array) {
    super("This action does not fit in one transaction; it needs the relayed path.");
    this.name = "NeedsIterativeError";
  }
}

export interface LaneCallResult extends AtomicSendResult { rlp: Hex; synthetic: Hex; nonce: bigint }

export async function buildLaneRlp(call: EvmCall, synthetic: Hex, deps: Pick<LaneCallDeps, "proxyUrl" | "chainId" | "fetchImpl">): Promise<{ rlp: Hex; nonce: bigint }> {
  const f: FetchLike | undefined = deps.fetchImpl;
  const [nonce, gasPrice, estimate] = await Promise.all([
    ethRpc.nonce(deps.proxyUrl, synthetic, f),
    ethRpc.gasPrice(deps.proxyUrl, f),
    ethRpc.estimateGas(deps.proxyUrl, { from: synthetic, ...call }, f),
  ]);
  const rlp = buildUnsignedEip1559Rlp({
    chainId: deps.chainId,
    nonce,
    maxPriorityFeePerGas: gasPrice,
    maxFeePerGas: gasPrice,
    gasLimit: (estimate * GAS_HEADROOM_NUMERATOR) / 10n,
    to: call.to,
    value: call.value ?? 0n,
    data: call.data,
  });
  return { rlp, nonce };
}

/** The EVM view lags Solana confirmation; a follow-up call must not reuse a spent nonce. */
export async function waitForNonceAdvance(proxyUrl: string, synthetic: Hex, from: bigint, tries = 20, waitMs = 1500, f?: FetchLike): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if ((await ethRpc.nonce(proxyUrl, synthetic, f)) > from) return true;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

export async function sendSolanaLaneCall(call: EvmCall, signer: LaneSigner, deps: LaneCallDeps): Promise<LaneCallResult> {
  const synthetic = syntheticAddress(signer.payer);
  const { rlp, nonce } = await buildLaneRlp(call, synthetic, deps);
  let result: AtomicSendResult;
  try {
    result = await submitAtomicV1(rlp, signer, deps);
  } catch (e) {
    if (e instanceof AtomicRefused) throw new NeedsIterativeError(rlp, synthetic, e.authSig);
    if (e instanceof Error && e.message.includes(ATOMIC_REQUIRES_ITERATIVE)) throw new NeedsIterativeError(rlp, synthetic);
    throw e;
  }
  const advanced = await waitForNonceAdvance(deps.proxyUrl, synthetic, nonce, deps.nonceWaitTries, deps.nonceWaitMs, deps.fetchImpl);
  if (!advanced) throw new Error(`The transaction confirmed on Solana (${result.signature}) but the EVM view has not caught up yet; check again in a moment.`);
  return { ...result, rlp, synthetic, nonce };
}
