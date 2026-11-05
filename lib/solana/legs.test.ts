import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { decodeFunctionData } from "viem";
import { buildFundInstructions, buildSweepLeg, HELPER_TRANSFER_SPL_ABI, pubkeyToBytes32 } from "./legs";
import { ACTIVATE_ATA_TAG, ownerInfoPda } from "./instructions";
import { ATA_PROGRAM, SPL_TOKEN_PROGRAM, associatedTokenAddress, externalAuthPda } from "./pdas";
import { syntheticAddress } from "../lane/identity";
import { HELPER_PRECOMPILE_ADDRESS } from "../wrapperGrant";

const PROGRAM = new PublicKey("RPTWwELXAY4KC9ZPHhaxp7Sq1hHtU3HNEgLbSegCcWf");
const MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // devnet USDC
const WALLET = new PublicKey("55R41dbRU13QhLpAgha1841wR5M6sAcZhXd4S1LGupBn");
const SYNTH = syntheticAddress(WALLET);
const base = { programId: PROGRAM, chainId: 200010, mint: MINT, wallet: WALLET, synthetic: SYNTH };

describe("fund leg", () => {
  it("ensures the synthetic's ATA (owner = external_auth PDA) then ActivateAta wallet ATA → synthetic ATA", () => {
    const [ensure, activate] = buildFundInstructions({ ...base, tokens: 100_000n });
    const synthPda = externalAuthPda(PROGRAM, SYNTH);
    const synthAta = associatedTokenAddress(MINT, synthPda);
    const walletAta = associatedTokenAddress(MINT, WALLET);
    expect(ensure!.programId.equals(ATA_PROGRAM)).toBe(true);
    expect(ensure!.keys[1]!.pubkey.equals(synthAta)).toBe(true);
    expect(ensure!.keys[2]!.pubkey.equals(synthPda)).toBe(true);
    expect(ensure!.data).toEqual(Buffer.from([1])); // idempotent variant
    expect(activate!.programId.equals(PROGRAM)).toBe(true);
    expect(activate!.keys.map((k) => k.pubkey.toBase58())).toEqual([
      WALLET, ownerInfoPda(PROGRAM), MINT, walletAta, synthAta, SPL_TOKEN_PROGRAM,
    ].map((k) => k.toBase58()));
    expect(activate!.keys[0]!.isSigner).toBe(true);
    // data = tag 18 ‖ chainId u64le ‖ mint ‖ tokens u64le
    const d = activate!.data;
    expect(d.length).toBe(49);
    expect(d[0]).toBe(ACTIVATE_ATA_TAG);
    expect(d.readBigUInt64LE(1)).toBe(200010n);
    expect(new PublicKey(d.subarray(9, 41)).equals(MINT)).toBe(true);
    expect(d.readBigUInt64LE(41)).toBe(100_000n);
  });
  it("refuses a zero amount", () => {
    expect(() => buildFundInstructions({ ...base, tokens: 0n })).toThrow(/positive/);
  });
});

describe("sweep leg", () => {
  it("creates the wallet's own ATA and encodes transfer_spl(walletAta, tokens, mint) to the helper precompile", () => {
    const leg = buildSweepLeg({ ...base, tokens: 50_000n });
    const walletAta = associatedTokenAddress(MINT, WALLET);
    expect(leg.walletAta.equals(walletAta)).toBe(true);
    expect(leg.ensureWalletAtaIx.keys[1]!.pubkey.equals(walletAta)).toBe(true);
    expect(leg.ensureWalletAtaIx.keys[2]!.pubkey.equals(WALLET)).toBe(true);
    expect(leg.call.to).toBe(HELPER_PRECOMPILE_ADDRESS);
    const d = decodeFunctionData({ abi: HELPER_TRANSFER_SPL_ABI, data: leg.call.data });
    expect(d.functionName).toBe("transfer_spl");
    expect(d.args).toEqual([pubkeyToBytes32(walletAta), 50_000n, pubkeyToBytes32(MINT)]);
    expect(leg.synthAta.equals(associatedTokenAddress(MINT, externalAuthPda(PROGRAM, SYNTH)))).toBe(true);
  });
  it("refuses zero and over-u64 amounts", () => {
    expect(() => buildSweepLeg({ ...base, tokens: 0n })).toThrow(/positive/);
    expect(() => buildSweepLeg({ ...base, tokens: 1n << 64n })).toThrow(/u64/);
  });
});

describe("fund shortfall", () => {
  it("is the missing part only, never negative", async () => {
    const { fundShortfall, withAccrualBuffer } = await import("./legs");
    expect(fundShortfall(0n, 100n)).toBe(100n);
    expect(fundShortfall(40n, 100n)).toBe(60n);
    expect(fundShortfall(100n, 100n)).toBe(0n);
    expect(fundShortfall(150n, 100n)).toBe(0n);
    expect(fundShortfall(5n, 0n)).toBe(0n);
    expect(withAccrualBuffer(1_000_000n)).toBe(1_001_000n);
    expect(withAccrualBuffer(1n)).toBe(2n);
  });
});
