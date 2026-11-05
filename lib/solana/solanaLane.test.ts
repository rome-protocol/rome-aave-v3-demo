import { describe, expect, it } from "vitest";
import { Buffer } from "buffer";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { decodeFunctionData, type Hex } from "viem";
import fixture from "./__fixtures__/composed-v1-fixture.json";
import { buildUnsignedEip1559Rlp } from "./unsignedTx";
import { accountsForProgram, parseV1Message, splitV1Wire } from "./v1Message";
import { authHashFor, authMessageFor, AUTH_MESSAGE_PREFIX, evmTxHashOf, submitAtomicV1 } from "./submit";
import { keypairLaneSigner } from "./keypairSigner";
import { buildLaneRlp, NeedsIterativeError, sendSolanaLaneCall } from "./laneCall";
import { ATOMIC_REQUIRES_ITERATIVE } from "./proxy";
import { APPROVE_SPL_ABI, APPROVE_SPL_SELECTOR, encodeApproveSplGrant, HELPER_PRECOMPILE_ADDRESS, MAX_SPL_ALLOWANCE, mintIdToBase58 } from "../wrapperGrant";
import { syntheticAddress } from "../lane/identity";

const ROME_PROGRAM = new PublicKey("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
const PAYER = new PublicKey(fixture.params.solanaPubkey);
const RLP = fixture.params.rlp as Hex;
const WIRE = new Uint8Array(Buffer.from(fixture.plan.transaction, "base64"));

describe("unsigned EIP-1559 body", () => {
  it("reproduces the real proxy capture byte for byte", () => {
    // fixture: chain 200010, nonce 134, fees 0, gas 1_000_000, to = own synthetic, value 0, no data
    const rlp = buildUnsignedEip1559Rlp({
      chainId: 200010, nonce: 134, maxPriorityFeePerGas: 0n, maxFeePerGas: 0n, gasLimit: 1_000_000n,
      to: fixture.synthetic as Hex, value: 0n, data: "0x",
    });
    expect(rlp).toBe(RLP);
    expect(rlp.startsWith("0x02")).toBe(false);
  });
  it("the synthetic in the capture is keccak256(pubkey)[12..]", () => {
    expect(syntheticAddress(PAYER)).toBe(fixture.synthetic);
  });
});

describe("auth message (what the wallet is asked to sign)", () => {
  it("is the readable envelope: 'Rome authorization\\n0x' + 64 lowercase hex of keccak256(0x02 ‖ rlp), 85 bytes, valid UTF-8", () => {
    const m = authMessageFor(RLP);
    expect(m).toHaveLength(85);
    const text = Buffer.from(m).toString("utf8");
    expect(text.startsWith("Rome authorization\n0x")).toBe(true);
    expect(text.slice(AUTH_MESSAGE_PREFIX.length)).toBe(Buffer.from(authHashFor(RLP)).toString("hex"));
    expect(/^[\x20-\x7e\n]+$/.test(text)).toBe(true); // printable — the wallet shows it as text
  });
  it("submitAtomicV1 signs the envelope, not the raw hash", async () => {
    const kp = Keypair.generate(); const s = keypairLaneSigner(kp);
    let signed: Uint8Array | null = null;
    const spy = { ...s, signAuthMessage: async (m: Uint8Array) => { signed = m; return s.signAuthMessage(m); } };
    const f: typeof fetch = async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "stop here" } }));
    await submitAtomicV1(RLP, spy, { proxyUrl: "p", solanaRpcUrl: "s", programId: ROME_PROGRAM, fetchImpl: f }).catch(() => {});
    expect(signed).not.toBeNull();
    expect(Buffer.from(signed!).toString("utf8")).toBe(Buffer.from(authMessageFor(RLP)).toString("utf8"));
  });

  it("is keccak256(0x02 ‖ rlp) — the captured wallet signature verifies over exactly these bytes", () => {
    const hash = authHashFor(RLP);
    expect(hash).toHaveLength(32);
    const sig = base58.decode(fixture.params.ed25519SigB58);
    expect(ed25519.verify(sig, hash, PAYER.toBytes())).toBe(true);
    // and NOT over the bare rlp, nor over the typed bytes unhashed
    expect(ed25519.verify(sig, Buffer.from(RLP.slice(2), "hex"), PAYER.toBytes())).toBe(false);
  });
  it("doubles as the EVM tx hash", () => {
    expect(evmTxHashOf(RLP)).toBe(`0x${Buffer.from(authHashFor(RLP)).toString("hex")}`);
  });
});

describe("v1 message", () => {
  it("splits the captured wire message-first with one trailing zero slot", () => {
    const { message, numRequiredSignatures } = splitV1Wire(WIRE);
    expect(WIRE.length).toBe(fixture.wire.len);
    expect(numRequiredSignatures).toBe(1);
    expect(message.length).toBe(fixture.wire.messageLen);
    expect(WIRE.subarray(message.length).every((b) => b === 0)).toBe(true);
  });
  it("parses header, config mask, keys and instructions; the Rome instruction is present", () => {
    const parsed = parseV1Message(splitV1Wire(WIRE).message);
    expect(parsed.header.numRequiredSignatures).toBe(1);
    expect(parsed.accountKeys[0]!.equals(PAYER)).toBe(true); // fee payer first
    expect(parsed.computeUnitLimit).toBeGreaterThan(0);
    const rome = accountsForProgram(parsed, ROME_PROGRAM);
    expect(rome).not.toBeNull();
    expect(rome!.some((m) => m.pubkey.equals(PAYER) && m.isSigner)).toBe(true);
    // the Ed25519 verifier instruction rides ahead of the Rome one
    const ED25519 = new PublicKey("Ed25519SigVerify111111111111111111111111111");
    expect(parsed.instructions.some((ix) => parsed.accountKeys[ix.programIdIndex]!.equals(ED25519))).toBe(true);
  });
  it("refuses a legacy/v0 wire and a truncated message", () => {
    const legacy = new Uint8Array(WIRE); legacy[0] = 0x80;
    expect(() => splitV1Wire(legacy)).toThrow(/not a v1 wire/);
    expect(() => parseV1Message(splitV1Wire(WIRE).message.subarray(0, 60))).toThrow(/truncated/);
  });
});

describe("wrapper grant", () => {
  it("encodes approve_spl(wrapper, max, mint) to the helper precompile with rome-ui's selector", () => {
    const mintId = `0x${Buffer.from(new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").toBytes()).toString("hex")}` as Hex;
    const g = encodeApproveSplGrant({ wrapper: "0xbce339ba4c3a8de3bb8af1c5539e6ac11da3112d", mintId });
    expect(g.to).toBe(HELPER_PRECOMPILE_ADDRESS);
    expect(g.data.slice(0, 10)).toBe(APPROVE_SPL_SELECTOR);
    const d = decodeFunctionData({ abi: APPROVE_SPL_ABI, data: g.data });
    expect((d.args![0] as string).toLowerCase()).toBe("0xbce339ba4c3a8de3bb8af1c5539e6ac11da3112d"); // viem checksums on decode
    expect(d.args![1]).toBe(MAX_SPL_ALLOWANCE);
    expect(d.args![2]).toBe(mintId);
    expect(mintIdToBase58(mintId)).toBe("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  });
});

// ---- the lane call against a fake proxy + fake Solana RPC --------------------
function fakeRpc(handlers: Record<string, (params: unknown[]) => unknown>) {
  const calls: { method: string; params: unknown[] }[] = [];
  const f: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] };
    calls.push(body);
    const h = handlers[body.method];
    if (!h) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: `no handler for ${body.method}` } }));
    const out = h(body.params);
    if (out instanceof Error) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: out.message } }));
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: out }));
  };
  return { f, calls };
}

describe("sendSolanaLaneCall", () => {
  const kp = Keypair.generate();
  const signer = keypairLaneSigner(kp);
  const synth = syntheticAddress(kp.publicKey);
  const call = { to: "0x81e7e7e4cbc2b5a55c2de1d3dfcf87c0cf867520" as Hex, data: "0xdeadbeef" as Hex };

  // a wire whose fee payer is `kp` and whose Rome instruction is present: re-key the captured message.
  function wireFor(payer: PublicKey): Uint8Array {
    const w = new Uint8Array(WIRE);
    w.set(payer.toBytes(), 42); // first account key = fee payer
    return w;
  }

  it("reads nonce/gasPrice/estimate for the synthetic, composes, signs twice, sends to the Solana RPC, waits for the nonce", async () => {
    let nonce = 5n;
    const seen: string[] = [];
    const rpc = fakeRpc({
      eth_getTransactionCount: () => `0x${nonce.toString(16)}`,
      eth_gasPrice: () => "0x3b9aca00",
      eth_estimateGas: (p) => { expect((p[0] as { from: string }).from).toBe(synth); return "0x186a0"; },
      rome_composeUnsignedAtomicV1: (p) => {
        const [rlp, payer, sigB58] = p as [Hex, string, string];
        expect(payer).toBe(kp.publicKey.toBase58());
        // the auth signature must verify over the ENVELOPE — the proxy verifies it (envelope or raw) before composing
        expect(ed25519.verify(base58.decode(sigB58), authMessageFor(rlp), kp.publicKey.toBytes())).toBe(true);
        return { recentBlockhash: "x", transaction: Buffer.from(wireFor(kp.publicKey)).toString("base64") };
      },
      getLatestBlockhash: () => ({ value: { blockhash: "x", lastValidBlockHeight: 1000 } }),
      sendTransaction: (p) => {
        const signed = new Uint8Array(Buffer.from((p as [string])[0], "base64"));
        const { message } = splitV1Wire(signed);
        // the trailing 64 bytes are a valid ed25519 signature of the message by the payer
        expect(ed25519.verify(signed.subarray(message.length), message, kp.publicKey.toBytes())).toBe(true);
        nonce = 6n; // the chain moved
        return "5igSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSigSig1";
      },
      getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
      getBlockHeight: () => 10,
      getTransaction: () => ({ meta: { computeUnitsConsumed: 222_222, logMessages: [] } }),
    });
    const r = await sendSolanaLaneCall(call, { ...signer, signAuthMessage: async (h) => { seen.push("auth"); return signer.signAuthMessage(h); }, signV1Wire: async (w) => { seen.push("tx"); return signer.signV1Wire(w); } },
      { proxyUrl: "proxy", solanaRpcUrl: "sol", programId: ROME_PROGRAM, chainId: 200010, fetchImpl: rpc.f, pollMs: 1, nonceWaitMs: 1 });
    expect(seen).toEqual(["auth", "tx"]);
    expect(r.computeUnitsConsumed).toBe(222_222);
    expect(r.nonce).toBe(5n);
    expect(r.evmTxHash).toBe(evmTxHashOf(r.rlp));
    expect(rpc.calls.map((c) => c.method)).toContain("rome_composeUnsignedAtomicV1");
    expect(rpc.calls.some((c) => c.method === "sendTransaction")).toBe(true);
  });

  it("refuses to sign a composed wire whose fee payer is not the wallet", async () => {
    const rpc = fakeRpc({
      eth_getTransactionCount: () => "0x1", eth_gasPrice: () => "0x1", eth_estimateGas: () => "0x186a0",
      rome_composeUnsignedAtomicV1: () => ({ recentBlockhash: "x", transaction: fixture.plan.transaction }), // payer = 55R41dbR…, not kp
    });
    let txSigned = false;
    await expect(sendSolanaLaneCall(call, { ...signer, signV1Wire: async (w) => { txSigned = true; return signer.signV1Wire(w); } },
      { proxyUrl: "p", solanaRpcUrl: "s", programId: ROME_PROGRAM, chainId: 200010, fetchImpl: rpc.f })).rejects.toThrow(/fee payer is not the connected wallet/);
    expect(txSigned).toBe(false);
  });

  it("surfaces the proxy's iterative verdict as NeedsIterativeError, before any transaction signature", async () => {
    const rpc = fakeRpc({
      eth_getTransactionCount: () => "0x1", eth_gasPrice: () => "0x1", eth_estimateGas: () => "0x186a0",
      rome_composeUnsignedAtomicV1: () => new Error(ATOMIC_REQUIRES_ITERATIVE),
    });
    const err = await sendSolanaLaneCall(call, signer, { proxyUrl: "p", solanaRpcUrl: "s", programId: ROME_PROGRAM, chainId: 200010, fetchImpl: rpc.f }).catch((e) => e);
    expect(err).toBeInstanceOf(NeedsIterativeError);
    expect((err as NeedsIterativeError).synthetic).toBe(synth);
  });

  it("buildLaneRlp: gas limit = estimate × 1.2, fees = gas price, nonce = the synthetic's pending nonce", async () => {
    const rpc = fakeRpc({ eth_getTransactionCount: () => "0x7", eth_gasPrice: () => "0x10", eth_estimateGas: () => "0x64" });
    const { rlp, nonce } = await buildLaneRlp(call, synth, { proxyUrl: "p", chainId: 200010, fetchImpl: rpc.f });
    expect(nonce).toBe(7n);
    expect(rlp).toBe(buildUnsignedEip1559Rlp({ chainId: 200010, nonce: 7, maxPriorityFeePerGas: 16n, maxFeePerGas: 16n, gasLimit: 120n, to: call.to, value: 0n, data: call.data }));
  });
});
