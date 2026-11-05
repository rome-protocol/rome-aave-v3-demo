import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import type { Hex } from "viem";
import fixture from "./__fixtures__/composed-v1-fixture.json";
import { buildUnsignedEip1559Rlp } from "./unsignedTx";
import { keypairLaneSigner } from "./keypairSigner";
import { splitV1Wire } from "./v1Message";
import { sendSignedPlan, PlanSigningRefused } from "./plan";

const ROME_PROGRAM = new PublicKey("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
const kp = Keypair.generate(); const signer = keypairLaneSigner(kp);
const RLP = buildUnsignedEip1559Rlp({ chainId: 200010, nonce: 3, maxPriorityFeePerGas: 1n, maxFeePerGas: 1n, gasLimit: 3_000_000n, to: "0x81e7e7e4cbc2b5a55c2de1d3dfcf87c0cf867520", value: 0n, data: "0xabcdef" });
const WIRE = new Uint8Array(Buffer.from(fixture.plan.transaction, "base64"));
function legFor(payer: PublicKey, salt: number): string { const w = new Uint8Array(WIRE); w.set(payer.toBytes(), 42); w[w.length - 65] ^= salt; return Buffer.from(w).toString("base64"); }

function fakeRpc(h: Record<string, (p: unknown[]) => unknown>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const f: typeof fetch = async (_u, init) => {
    const b = JSON.parse(String(init?.body)) as { method: string; params: unknown[] }; calls.push(b);
    const fn = h[b.method]; if (!fn) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `no ${b.method}` } }));
    const out = fn(b.params); if (out instanceof Error) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: out.message } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: out }));
  };
  return { f, calls };
}
const deps = (f: typeof fetch) => ({ proxyUrl: "p", solanaRpcUrl: "s", programId: ROME_PROGRAM, chainId: 200010, fetchImpl: f, pollMs: 1 });

describe("sendSignedPlan — the direct path for a call that cannot be atomic", () => {
  it("composes the plan, batch-signs every leg in ONE wallet call, broadcasts ALL legs at once, and calls it done when the synthetic's nonce advances", async () => {
    let nonce = 3n; const sent: string[] = []; let batchCalls = 0;
    const rpc = fakeRpc({
      rome_composeUnsignedIterativeV1: (p) => { expect((p as string[])[1]).toBe(kp.publicKey.toBase58()); return { recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1), legFor(kp.publicKey, 2), legFor(kp.publicKey, 3)] }; },
      getLatestBlockhash: () => ({ value: { blockhash: "x", lastValidBlockHeight: 1000 } }),
      sendTransaction: (p) => { const signed = new Uint8Array(Buffer.from((p as [string])[0], "base64")); const { message } = splitV1Wire(signed); expect(ed25519.verify(signed.subarray(message.length), message, kp.publicKey.toBytes())).toBe(true); sent.push((p as [string])[0]); if (sent.length === 3) nonce = 4n; return `sig${sent.length}`; },
      getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
      getBlockHeight: () => 10,
      eth_getTransactionCount: () => `0x${nonce.toString(16)}`,
    });
    const batchSigner = { ...signer, signV1Wires: async (wires: Uint8Array[]) => { batchCalls++; return Promise.all(wires.map((w) => signer.signV1Wire(w))); } };
    const r = await sendSignedPlan(RLP, new Uint8Array(64), batchSigner, deps(rpc.f));
    expect(batchCalls).toBe(1);
    expect(r.signatures.sort()).toEqual(["sig1", "sig2", "sig3"]);
    expect(r.legs).toBe(3);
    // every leg was broadcast BEFORE any status was polled: blind-fired together, like the proxy does
    const methods = rpc.calls.map((c) => c.method);
    const lastSend = methods.lastIndexOf("sendTransaction"); const firstStatus = methods.indexOf("getSignatureStatuses");
    expect(lastSend).toBeLessThan(firstStatus === -1 ? Infinity : firstStatus);
  });
  it("refuses BEFORE prompting when any leg's fee payer is not the wallet", async () => {
    const rpc = fakeRpc({ rome_composeUnsignedIterativeV1: () => ({ recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1), fixture.plan.transaction] }) });
    let prompted = false;
    await expect(sendSignedPlan(RLP, new Uint8Array(64), { ...signer, signV1Wires: async (w) => { prompted = true; return Promise.all(w.map((x) => signer.signV1Wire(x))); } }, deps(rpc.f))).rejects.toThrow(/leg 2.*fee payer/);
    expect(prompted).toBe(false);
  });
  it("refuses a leg whose message the wallet altered, before sending anything", async () => {
    const rpc = fakeRpc({ rome_composeUnsignedIterativeV1: () => ({ recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1)] }), sendTransaction: () => { throw new Error("must not send"); } });
    const bad = { ...signer, signV1Wires: async (w: Uint8Array[]) => w.map(() => { const s = new Uint8Array(64).fill(1); return s; }) }; // garbage sigs → verify fails
    await expect(sendSignedPlan(RLP, new Uint8Array(64), bad, deps(rpc.f))).rejects.toThrow(/signature does not verify/);
    expect(rpc.calls.some((c) => c.method === "sendTransaction")).toBe(false);
  });
  it("a wallet that refuses (or cannot batch-sign) surfaces PlanSigningRefused so the caller can fall back", async () => {
    const rpc = fakeRpc({ rome_composeUnsignedIterativeV1: () => ({ recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1)] }) });
    const refusing = { ...signer, signV1Wires: async () => { throw new Error("Transaction cancelled"); } };
    await expect(sendSignedPlan(RLP, new Uint8Array(64), refusing, deps(rpc.f))).rejects.toBeInstanceOf(PlanSigningRefused);
    const noBatch = { ...signer, signV1Wires: undefined };
    await expect(sendSignedPlan(RLP, new Uint8Array(64), noBatch, deps(rpc.f))).rejects.toBeInstanceOf(PlanSigningRefused);
  });
  it("a leg that errors is tolerated when the session still completes (redundant legs no-op), and reported when the nonce never moves", async () => {
    const batchSigner = { ...signer, signV1Wires: async (w: Uint8Array[]) => Promise.all(w.map((x) => signer.signV1Wire(x))) };
    // completes: leg 2 rejected at send, nonce still advances → success with 1 signature
    let n = 0; let nonce = 3n;
    const ok = fakeRpc({
      rome_composeUnsignedIterativeV1: () => ({ recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1), legFor(kp.publicKey, 2)] }),
      getLatestBlockhash: () => ({ value: { blockhash: "x", lastValidBlockHeight: 1000 } }),
      sendTransaction: () => { n++; if (n === 2) return new Error("Transaction simulation failed: session already complete"); nonce = 4n; return `sig${n}`; },
      eth_getTransactionCount: () => `0x${nonce.toString(16)}`, getBlockHeight: () => 10,
    });
    const r = await sendSignedPlan(RLP, new Uint8Array(64), batchSigner, deps(ok.f));
    expect(r.signatures).toEqual(["sig1"]); expect(r.legs).toBe(2); expect(r.legErrors).toHaveLength(1);
    // does not complete: nonce stays, blockhash expires → error carries the leg failures
    let m = 0;
    const bad = fakeRpc({
      rome_composeUnsignedIterativeV1: () => ({ recentBlockhash: "x", transactions: [legFor(kp.publicKey, 1), legFor(kp.publicKey, 2)] }),
      getLatestBlockhash: () => ({ value: { blockhash: "x", lastValidBlockHeight: 5 } }),
      sendTransaction: () => `sig${++m}`,
      getSignatureStatuses: () => ({ value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }, { err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed" }] }),
      eth_getTransactionCount: () => "0x3", getBlockHeight: () => 10, getTransaction: () => ({ meta: { logMessages: ["Program log: boom"] } }),
    });
    await expect(sendSignedPlan(RLP, new Uint8Array(64), batchSigner, deps(bad.f))).rejects.toThrow(/did not complete.*boom/s);
  });
});
