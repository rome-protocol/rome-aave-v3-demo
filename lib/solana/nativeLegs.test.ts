import { describe, it, expect } from "vitest";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { buildFundInstructions, buildSweepLeg } from "./legs";
import { SPL_TOKEN_PROGRAM, associatedTokenAddress } from "./pdas";
import { ATA_PROGRAM } from "./pdas";
import { NATIVE_MINT, SOL_FEE_RESERVE_LAMPORTS, readWalletSide, tokenAmountOf, walletSideBalance } from "./walletBalance";
import { accountsForProgram, encodeV1Message, NATIVE_V1_COMPUTE_UNIT_LIMIT, NATIVE_V1_LOADED_ACCOUNTS_DATA_SIZE, parseV1Message, splitV1Wire } from "./v1Message";

const programId = Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;
const usdc = Keypair.generate().publicKey;
const synthetic = "0x00000000000000000000000000000000000000aa" as const;
const base = { programId, chainId: 200010, wallet, synthetic };

describe("wallet balance rule", () => {
  it("a token mint counts only the wallet's own token account", () => {
    expect(walletSideBalance({ mint: usdc, ataTokens: 5n, lamports: 10n ** 12n })).toBe(5n);
  });

  it("native SOL adds plain SOL minus the 0.02 SOL fee reserve", () => {
    expect(walletSideBalance({ mint: NATIVE_MINT, ataTokens: 7n, lamports: SOL_FEE_RESERVE_LAMPORTS + 1_000n })).toBe(1_007n);
    expect(walletSideBalance({ mint: NATIVE_MINT, ataTokens: 7n, lamports: 5n })).toBe(7n);
  });

  it("reads token accounts and lamports in one pass; a missing account is 0, an RPC error throws", async () => {
    const data = new Uint8Array(165);
    new DataView(data.buffer).setBigUint64(64, 42n, true);
    expect(tokenAmountOf(data)).toBe(42n);
    const ok = { getMultipleAccountsInfo: async () => [{ data }, null], getBalance: async () => 0 };
    expect(await readWalletSide(ok, wallet, [usdc, Keypair.generate().publicKey])).toEqual([42n, 0n]);
    const bad = { getMultipleAccountsInfo: async () => { throw new Error("429"); }, getBalance: async () => 0 };
    await expect(readWalletSide(bad, wallet, [usdc])).rejects.toThrow("429");
  });
});

describe("native SOL fund and sweep", () => {
  it("a token fund is unchanged: ensure the synthetic ATA, then ActivateAta", () => {
    expect(buildFundInstructions({ ...base, mint: usdc, tokens: 10n })).toHaveLength(2);
  });

  it("wSOL fund with a shortfall wraps first: create wSOL account, transfer lamports, syncNative", () => {
    const ixs = buildFundInstructions({ ...base, mint: NATIVE_MINT, tokens: 10n, wrapMissing: 4n });
    expect(ixs).toHaveLength(5);
    const walletAta = associatedTokenAddress(NATIVE_MINT, wallet);
    expect(ixs[0]!.programId.equals(ATA_PROGRAM)).toBe(true);
    expect(ixs[1]!.programId.equals(SystemProgram.programId)).toBe(true);
    expect(ixs[1]!.keys[1]!.pubkey.equals(walletAta)).toBe(true);
    expect(ixs[1]!.data.readUInt32LE(0)).toBe(2); // system transfer
    expect(ixs[1]!.data.readBigUInt64LE(4)).toBe(4n);
    expect(ixs[2]!.programId.equals(SPL_TOKEN_PROGRAM)).toBe(true);
    expect([...ixs[2]!.data]).toEqual([17]); // syncNative
    expect(ixs[2]!.keys[0]!.pubkey.equals(walletAta)).toBe(true);
  });

  it("wSOL fund with nothing missing sends no wrap; wrapMissing on a token mint is refused", () => {
    expect(buildFundInstructions({ ...base, mint: NATIVE_MINT, tokens: 10n, wrapMissing: 0n })).toHaveLength(2);
    expect(() => buildFundInstructions({ ...base, mint: usdc, tokens: 10n, wrapMissing: 1n })).toThrow();
  });

  it("the wSOL sweep closes the wallet's wSOL account to the wallet; a token sweep does not", () => {
    const sol = buildSweepLeg({ ...base, mint: NATIVE_MINT, tokens: 10n });
    expect([...sol.closeWalletAtaIx!.data]).toEqual([9]);
    expect(sol.closeWalletAtaIx!.keys[0]!.pubkey.equals(sol.walletAta)).toBe(true);
    expect(sol.closeWalletAtaIx!.keys[1]!.pubkey.equals(wallet)).toBe(true);
    expect(buildSweepLeg({ ...base, mint: usdc, tokens: 10n }).closeWalletAtaIx).toBeNull();
  });
});

describe("v1 message for native instructions", () => {
  it("round-trips through the lane's own v1 parser", () => {
    const ixs = buildFundInstructions({ ...base, mint: NATIVE_MINT, tokens: 10n, wrapMissing: 4n });
    const bh = Keypair.generate().publicKey.toBytes();
    const message = encodeV1Message({ payer: wallet, recentBlockhash: bh, instructions: ixs });
    const wire = new Uint8Array(message.length + 64);
    wire.set(message);
    const parsed = parseV1Message(splitV1Wire(wire).message);
    expect(parsed.header.numRequiredSignatures).toBe(1);
    expect(parsed.accountKeys[0]!.equals(wallet)).toBe(true);
    expect(parsed.instructions).toHaveLength(5);
    expect(parsed.instructions[1]!.data).toEqual(new Uint8Array(ixs[1]!.data));
    // the Rome instruction keeps its account order, signer first
    const rome = accountsForProgram(parsed, programId)!;
    expect(rome.map((m) => m.pubkey.toBase58())).toEqual(ixs[4]!.keys.map((k) => k.pubkey.toBase58()));
    expect(rome[0]!.isSigner).toBe(true);
    // every program id sits read-only after the signer
    expect(parsed.accountKeys.some((k) => k.equals(new PublicKey("11111111111111111111111111111111")))).toBe(true);
  });

  it("always sets the compute-unit and loaded-accounts-data limits (an unset v1 limit is zero)", () => {
    const ixs = buildFundInstructions({ ...base, mint: NATIVE_MINT, tokens: 10n, wrapMissing: 4n });
    const message = encodeV1Message({ payer: wallet, recentBlockhash: Keypair.generate().publicKey.toBytes(), instructions: ixs });
    const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
    expect(view.getUint32(4, true)).toBe(0b1100);
    const configAt = 42 + 32 * message[41]!;
    expect(view.getUint32(configAt, true)).toBe(NATIVE_V1_COMPUTE_UNIT_LIMIT);
    expect(view.getUint32(configAt + 4, true)).toBe(NATIVE_V1_LOADED_ACCOUNTS_DATA_SIZE);
    const wire = new Uint8Array(message.length + 64);
    wire.set(message);
    expect(parseV1Message(splitV1Wire(wire).message).computeUnitLimit).toBe(NATIVE_V1_COMPUTE_UNIT_LIMIT);
  });
});
