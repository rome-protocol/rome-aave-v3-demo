// Money in and out of the synthetic ("the synthetic holds nothing at rest").
//
//   FUND  — wallet ATA → synthetic ATA. Native Solana: ensure the synthetic's
//           ATA (idempotent) + rome-evm ActivateAta (tag 18). ONE wallet-signed
//           v1 transaction; no proxy, no EVM call. For the native SOL mint the
//           same transaction first tops the wallet's wSOL account up from plain
//           SOL (create if missing, transfer, syncNative).
//   SWEEP — synthetic ATA → wallet ATA. An EVM call FROM the synthetic to the
//           helper precompile, `transfer_spl(to_ata, tokens, mint)`, which
//           signs as the synthetic's external_auth PDA. Goes through the same
//           atomic v1 lane as every other call. The wallet's ATA must exist
//           first (idempotent native create, wallet-signed).
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { encodeFunctionData, type Hex } from "viem";
import { HELPER_PRECOMPILE_ADDRESS } from "@/lib/wrapperGrant";
import { SPL_TOKEN_PROGRAM, associatedTokenAddress, externalAuthPda } from "./pdas";
import { buildActivateAtaInstruction, closeAccountIx, createAtaIdempotentIx, syncNativeIx } from "./instructions";
import { isNativeMint } from "./walletBalance";

export const HELPER_TRANSFER_SPL_ABI = [
  { type: "function", name: "transfer_spl", stateMutability: "nonpayable",
    inputs: [{ name: "to_ata", type: "bytes32" }, { name: "tokens", type: "uint64" }, { name: "mint", type: "bytes32" }], outputs: [] },
] as const;

export function pubkeyToBytes32(pk: PublicKey): Hex {
  return `0x${Buffer.from(pk.toBytes()).toString("hex")}`;
}

export interface LegParams {
  programId: PublicKey;
  chainId: number | bigint;
  /** The SPL mint — read from the wrapper's `mint_id()`, never assumed. */
  mint: PublicKey;
  /** Base units. */
  tokens: bigint;
  wallet: PublicKey;
  synthetic: Hex;
  tokenProgram?: PublicKey;
  /** Native-SOL mint only: lamports the wallet's wSOL account lacks for `tokens`. The same transaction creates that account if missing, transfers them in and syncs it. */
  wrapMissing?: bigint;
}

/** The fund leg's instructions, in order, for one wallet-signed native transaction. */
export function buildFundInstructions(p: LegParams): TransactionInstruction[] {
  if (p.tokens <= 0n) throw new Error("buildFundInstructions: tokens must be positive");
  const tokenProgram = p.tokenProgram ?? SPL_TOKEN_PROGRAM;
  const synthPda = externalAuthPda(p.programId, p.synthetic);
  const walletAta = associatedTokenAddress(p.mint, p.wallet, tokenProgram);
  const synthAta = associatedTokenAddress(p.mint, synthPda, tokenProgram);
  const wrap: TransactionInstruction[] = [];
  if (p.wrapMissing && p.wrapMissing > 0n) {
    if (!isNativeMint(p.mint)) throw new Error("buildFundInstructions: wrapMissing is for the native SOL mint only");
    wrap.push(
      createAtaIdempotentIx({ payer: p.wallet, owner: p.wallet, mint: p.mint, tokenProgram }),
      SystemProgram.transfer({ fromPubkey: p.wallet, toPubkey: walletAta, lamports: p.wrapMissing }),
      syncNativeIx(walletAta),
    );
  }
  return [
    ...wrap,
    createAtaIdempotentIx({ payer: p.wallet, owner: synthPda, mint: p.mint, tokenProgram }),
    buildActivateAtaInstruction({ programId: p.programId, chainId: p.chainId, mint: p.mint, tokens: p.tokens, signer: p.wallet, fromAta: walletAta, toAta: synthAta, tokenProgram }),
  ];
}

export interface SweepLeg {
  /** Idempotent create of the wallet's own ATA — transfer_spl reverts into a missing destination. Wallet-signed, native. */
  ensureWalletAtaIx: TransactionInstruction;
  /** The EVM call the synthetic sends over the lane. */
  call: { to: Hex; data: Hex };
  /** Native SOL mint only: closes the wallet's wSOL account after the sweep so the user holds plain SOL. */
  closeWalletAtaIx: TransactionInstruction | null;
  walletAta: PublicKey;
  synthAta: PublicKey;
}

export function buildSweepLeg(p: LegParams): SweepLeg {
  if (p.tokens <= 0n) throw new Error("buildSweepLeg: tokens must be positive");
  if (p.tokens > 0xffffffffffffffffn) throw new Error("buildSweepLeg: tokens exceed u64");
  const tokenProgram = p.tokenProgram ?? SPL_TOKEN_PROGRAM;
  const synthPda = externalAuthPda(p.programId, p.synthetic);
  const walletAta = associatedTokenAddress(p.mint, p.wallet, tokenProgram);
  const synthAta = associatedTokenAddress(p.mint, synthPda, tokenProgram);
  return {
    ensureWalletAtaIx: createAtaIdempotentIx({ payer: p.wallet, owner: p.wallet, mint: p.mint, tokenProgram }),
    call: {
      to: HELPER_PRECOMPILE_ADDRESS,
      data: encodeFunctionData({ abi: HELPER_TRANSFER_SPL_ABI, functionName: "transfer_spl", args: [pubkeyToBytes32(walletAta), p.tokens, pubkeyToBytes32(p.mint)] }),
    },
    closeWalletAtaIx: isNativeMint(p.mint) ? closeAccountIx({ account: walletAta, destination: p.wallet, owner: p.wallet }) : null,
    walletAta,
    synthAta,
  };
}

/**
 * How much the synthetic must be topped up with before an action that pulls
 * `needed` base units from it. A full repay passes the debt (plus a small
 * accrual buffer computed by the caller) rather than the MAX sentinel.
 */
export function fundShortfall(syntheticBalance: bigint, needed: bigint): bigint {
  if (needed <= 0n) return 0n;
  return needed > syntheticBalance ? needed - syntheticBalance : 0n;
}

/** Interest accrues between the balance read and the repay landing; cover ~0.1 % (rounded up). */
export function withAccrualBuffer(debt: bigint): bigint {
  return debt + (debt + 999n) / 1000n;
}
