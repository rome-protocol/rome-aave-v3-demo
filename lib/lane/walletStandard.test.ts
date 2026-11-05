import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { FLAGGED_BY_MISTAKE_NOTE, standardWalletOf, walletLaneSigner, type StandardWalletLike } from "./walletStandard";

const SIGNER = "55R41dbRU13QhLpAgha1841wR5M6sAcZhXd4S1LGupBn";
const CHAIN = "solana:devnet";

function fakeWallet(over: Partial<{ message: boolean; tx: boolean; tamper: boolean; short: boolean; account: string }> = {}): StandardWalletLike {
  const features: Record<string, unknown> = {};
  if (over.message !== false) {
    features["solana:signMessage"] = {
      signMessage: async (...inputs: { message: Uint8Array }[]) =>
        inputs.map((i) => ({ signature: new Uint8Array(over.short ? 63 : 64).fill(i.message[0] ?? 1) })),
    };
  }
  if (over.tx !== false) {
    features["solana:signTransaction"] = {
      signTransaction: async (...inputs: { transaction: Uint8Array; chain?: string }[]) =>
        inputs.map((i) => {
          const out = new Uint8Array(i.transaction);
          if (over.tamper) out[2] ^= 0xff;
          out.fill(7, out.length - 64); // the trailing slot becomes the signature
          return { signedTransaction: out };
        }),
    };
  }
  return { name: "Fake", accounts: [{ address: over.account ?? SIGNER }], features };
}

function v1Wire(messageLen = 100): Uint8Array {
  const w = new Uint8Array(messageLen + 64);
  w[0] = 0x81; w[1] = 1; // version byte, one required signature
  for (let i = 2; i < messageLen; i++) w[i] = i & 0xff;
  return w; // trailing 64 bytes zero = the empty signature slot
}

describe("walletLaneSigner", () => {
  const ENVELOPE = new Uint8Array(Buffer.from("Rome authorization\n0x" + "ab".repeat(32)));
  it("auth message goes through solana:signMessage as the readable envelope and returns 64 bytes", async () => {
    const s = walletLaneSigner(fakeWallet(), SIGNER, CHAIN);
    expect(s.payer.equals(new PublicKey(SIGNER))).toBe(true);
    const sig = await s.signAuthMessage(ENVELOPE);
    expect(sig).toHaveLength(64);
    expect(sig[0]).toBe(ENVELOPE[0]);
  });
  it("only the envelope form is offered to the wallet — raw 32 bytes or other text are refused before prompting", async () => {
    const s = walletLaneSigner(fakeWallet(), SIGNER, CHAIN);
    await expect(s.signAuthMessage(new Uint8Array(32))).rejects.toThrow(/Rome authorization/);
    await expect(s.signAuthMessage(new Uint8Array(Buffer.from("please sign this")))).rejects.toThrow(/Rome authorization/);
  });
  it("a wallet without solana:signMessage cannot use the lane", async () => {
    const s = walletLaneSigner(fakeWallet({ message: false }), SIGNER, CHAIN);
    await expect(s.signAuthMessage(ENVELOPE)).rejects.toThrow(/signMessage/);
  });
  it("a short signature is refused", async () => {
    const s = walletLaneSigner(fakeWallet({ short: true }), SIGNER, CHAIN);
    await expect(s.signAuthMessage(ENVELOPE)).rejects.toThrow(/64-byte/);
  });
  it("v1 wire: returns only the trailing 64-byte slot, message untouched", async () => {
    const s = walletLaneSigner(fakeWallet(), SIGNER, CHAIN);
    const sig = await s.signV1Wire(v1Wire());
    expect(sig).toHaveLength(64);
    expect(Array.from(sig).every((b) => b === 7)).toBe(true);
  });
  it("v1 wire: refuses a non-v1 wire before prompting", async () => {
    const s = walletLaneSigner(fakeWallet(), SIGNER, CHAIN);
    const legacy = v1Wire(); legacy[0] = 0x01;
    await expect(s.signV1Wire(legacy)).rejects.toThrow(/0x81/);
  });
  it("v1 wire: a wallet that alters the message is refused", async () => {
    const s = walletLaneSigner(fakeWallet({ tamper: true }), SIGNER, CHAIN);
    await expect(s.signV1Wire(v1Wire())).rejects.toThrow(/altered/);
  });
  it("v1 wire: a wallet without solana:signTransaction cannot use the lane", async () => {
    const s = walletLaneSigner(fakeWallet({ tx: false }), SIGNER, CHAIN);
    await expect(s.signV1Wire(v1Wire())).rejects.toThrow(/signTransaction/);
  });
  // A wallet whose first N signTransaction calls throw `msg`, then signs normally.
  function flaky(failures: number, msg: string) {
    const w = fakeWallet();
    const real = (w.features["solana:signTransaction"] as { signTransaction: (...i: never[]) => Promise<unknown> }).signTransaction;
    let calls = 0;
    (w.features["solana:signTransaction"] as { signTransaction: unknown }).signTransaction = async (...i: never[]) => {
      if (calls++ < failures) throw new Error(msg);
      return real(...i);
    };
    return { w, calls: () => calls };
  }
  it("v1 wire: a first refusal that is not a deliberate Reject is asked again once, with a note", async () => {
    const { w, calls } = flaky(1, "Cancelled");
    const notes: string[] = [];
    const sig = await walletLaneSigner(w, SIGNER, CHAIN, (n) => notes.push(n)).signV1Wire(v1Wire());
    expect(sig).toHaveLength(64);
    expect(calls()).toBe(2);
    expect(notes).toEqual([FLAGGED_BY_MISTAKE_NOTE]);
  });
  it("v1 wire: a wallet that says the user rejected is final (no second prompt) and the error does not blame v1 support", async () => {
    const { w, calls } = flaky(1, "User rejected the request.");
    await expect(walletLaneSigner(w, SIGNER, CHAIN).signV1Wire(v1Wire())).rejects.toThrow(/^The wallet did not sign the transaction: User rejected the request\.$/);
    expect(calls()).toBe(1);
  });
  it("v1 wire: Solflare's 'Transaction cancelled' (Close on a false flag looks the same as Reject) is asked once more", async () => {
    const { w, calls } = flaky(1, "Transaction cancelled");
    await walletLaneSigner(w, SIGNER, CHAIN).signV1Wire(v1Wire());
    expect(calls()).toBe(2);
  });
  it("v1 wires (plan path): a wallet that says the user rejected is final", async () => {
    const { w, calls } = flaky(1, "User rejected the request.");
    await expect(walletLaneSigner(w, SIGNER, CHAIN).signV1Wires!([v1Wire(), v1Wire(120)])).rejects.toThrow(/rejected/);
    expect(calls()).toBe(1);
  });
  it("v1 wire: two refusals in a row stop after the second ask", async () => {
    const { w, calls } = flaky(5, "Cancelled");
    await expect(walletLaneSigner(w, SIGNER, CHAIN).signV1Wire(v1Wire())).rejects.toThrow(/did not sign/);
    expect(calls()).toBe(2);
  });
  it("v1 wires (one prompt for several): the same one-time re-ask", async () => {
    const { w, calls } = flaky(1, "Cancelled");
    const sigs = await walletLaneSigner(w, SIGNER, CHAIN).signV1Wires!([v1Wire(), v1Wire(120)]);
    expect(sigs).toHaveLength(2);
    expect(calls()).toBe(2);
  });
  it("the wallet's account must be the connected one", () => {
    expect(() => walletLaneSigner(fakeWallet({ account: "11111111111111111111111111111111" }), SIGNER, CHAIN)).toThrow(/active account/);
  });
});

describe("standardWalletOf", () => {
  it("reads the Wallet Standard wallet off a StandardWalletAdapter-shaped adapter", () => {
    const w = fakeWallet();
    expect(standardWalletOf({ wallet: w })).toBe(w);
  });
  it("a legacy adapter (no .wallet) → null", () => {
    expect(standardWalletOf({ name: "Legacy" })).toBeNull();
    expect(standardWalletOf(null)).toBeNull();
  });
});
