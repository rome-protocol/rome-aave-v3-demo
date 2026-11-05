import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import type { Hex } from "viem";
import fixture from "./__fixtures__/composed-v1-fixture.json";
import { buildUnsignedEip1559Rlp } from "./unsignedTx";
import { ensureSyntheticGas, maxGasCostWei, sendRelayed } from "./relay";
import { authMessageFor, evmTxHashOf } from "./submit";
import { keypairLaneSigner } from "./keypairSigner";
import { splitV1Wire } from "./v1Message";

const ROME_PROGRAM = new PublicKey("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
const kp = Keypair.generate();
const signer = keypairLaneSigner(kp);
const RLP = buildUnsignedEip1559Rlp({ chainId: 200010, nonce: 3, maxPriorityFeePerGas: 1_000_000_000n, maxFeePerGas: 1_000_000_000n, gasLimit: 3_000_000n, to: "0x81e7e7e4cbc2b5a55c2de1d3dfcf87c0cf867520", value: 0n, data: "0xabcdef" });
const WIRE = new Uint8Array(Buffer.from(fixture.plan.transaction, "base64"));
function wireFor(payer: PublicKey): string { const w = new Uint8Array(WIRE); w.set(payer.toBytes(), 42); return Buffer.from(w).toString("base64"); }

function fakeRpc(h: Record<string, (p: unknown[]) => unknown>) {
  const calls: string[] = [];
  const f: typeof fetch = async (_u, init) => {
    const b = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(b.method);
    const fn = h[b.method]; if (!fn) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `no ${b.method}` } }));
    const out = fn(b.params); if (out instanceof Error) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: out.message } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: out }));
  };
  return { f, calls };
}
const deps = (f: typeof fetch, extra: Record<string, unknown> = {}) => ({ proxyUrl: "p", solanaRpcUrl: "s", programId: ROME_PROGRAM, fetchImpl: f, pollMs: 1, ...extra });

describe("maxGasCostWei", () => {
  it("is gasLimit × maxFeePerGas of the body", () => { expect(maxGasCostWei(RLP)).toBe(3_000_000n * 1_000_000_000n); });
});

describe("ensureSyntheticGas", () => {
  it("does nothing when the synthetic already holds enough", async () => {
    const rpc = fakeRpc({ eth_getBalance: () => "0x" + (10n ** 19n).toString(16) });
    expect(await ensureSyntheticGas(10n ** 15n, signer, deps(rpc.f))).toBeNull();
    expect(rpc.calls).toEqual(["eth_getBalance"]);
  });
  it("tops up by the shortfall rounded up to 1e12 wei, wallet-signs the deposit wire, waits for the credit", async () => {
    let bal = 5n * 10n ** 11n; // 0.5e12
    const phases: string[] = [];
    const rpc = fakeRpc({
      eth_getBalance: () => "0x" + bal.toString(16),
      rome_composeExternalDepositV1: (p) => {
        expect(p[0]).toBe(kp.publicKey.toBase58());
        // needed 2e12 − 0.5e12 = 1.5e12 → rounded up to 2e12
        expect(BigInt(p[1] as string)).toBe(2n * 10n ** 12n);
        return { recentBlockhash: "x", transaction: wireFor(kp.publicKey) };
      },
      getLatestBlockhash: () => ({ value: { blockhash: "x", lastValidBlockHeight: 99 } }),
      sendTransaction: (p) => {
        const signed = new Uint8Array(Buffer.from((p as [string])[0], "base64"));
        const { message } = splitV1Wire(signed);
        expect(ed25519.verify(signed.subarray(message.length), message, kp.publicKey.toBytes())).toBe(true);
        bal = 3n * 10n ** 12n; return "DepositSig111111111111111111111111111111111111111111111111111111111111111111111";
      },
      getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
    });
    const sig = await ensureSyntheticGas(2n * 10n ** 12n, signer, deps(rpc.f, { onPhase: (p: string) => phases.push(p) }));
    expect(sig).toMatch(/^DepositSig/);
    expect(phases).toEqual(["depositing"]);
  });
  it("refuses a deposit wire whose fee payer is not the wallet", async () => {
    const rpc = fakeRpc({ eth_getBalance: () => "0x0", rome_composeExternalDepositV1: () => ({ recentBlockhash: "x", transaction: fixture.plan.transaction }) });
    await expect(ensureSyntheticGas(1n, signer, deps(rpc.f))).rejects.toThrow(/fee payer is not the connected wallet/);
  });
});

describe("sendRelayed", () => {
  it("one auth signature, verified by the fake proxy; returns the hash the proxy must echo", async () => {
    const seen: string[] = [];
    const rpc = fakeRpc({
      eth_getBalance: () => "0x" + (10n ** 19n).toString(16),
      rome_relayUnsignedV1: (p) => {
        const [rlp, payer, sigB58] = p as [Hex, string, string];
        expect(rlp).toBe(RLP); expect(payer).toBe(kp.publicKey.toBase58());
        expect(ed25519.verify(base58.decode(sigB58), authMessageFor(rlp), kp.publicKey.toBytes())).toBe(true);
        return evmTxHashOf(rlp);
      },
    });
    const r = await sendRelayed(RLP, { ...signer, signV1Wire: async () => { throw new Error("must not be asked for a transaction signature"); } }, deps(rpc.f, { onPhase: (p: string) => seen.push(p) }));
    expect(r.evmTxHash).toBe(evmTxHashOf(RLP));
    expect(r.depositSignature).toBeNull();
    expect(seen).toEqual(["relaying"]);
  });
  it("refuses when the proxy echoes a different hash", async () => {
    const rpc = fakeRpc({ eth_getBalance: () => "0x" + (10n ** 19n).toString(16), rome_relayUnsignedV1: () => "0x" + "11".repeat(32) });
    await expect(sendRelayed(RLP, signer, deps(rpc.f))).rejects.toThrow(/different transaction/);
  });
});
