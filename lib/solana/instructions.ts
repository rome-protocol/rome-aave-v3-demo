// Native Solana instructions the fund leg is made of. rome-evm's ActivateAta
// (tag 18) moves SPL from the wallet's ATA into the synthetic's ATA (owned by
// the synthetic's external_auth PDA) in one wallet-signed instruction.
import { Buffer } from "buffer";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { ATA_PROGRAM, SPL_TOKEN_PROGRAM, SYSTEM_PROGRAM, associatedTokenAddress } from "./pdas";

export const ACTIVATE_ATA_TAG = 18;

export function buildActivateAtaData(params: { chainId: number | bigint; mint: PublicKey; tokens: bigint }): Buffer {
  const data = Buffer.alloc(1 + 8 + 32 + 8);
  data.writeUInt8(ACTIVATE_ATA_TAG, 0);
  data.writeBigUInt64LE(BigInt(params.chainId), 1);
  Buffer.from(params.mint.toBytes()).copy(data, 9);
  data.writeBigUInt64LE(params.tokens, 41);
  return data;
}

export function createAtaIdempotentIx(params: { payer: PublicKey; owner: PublicKey; mint: PublicKey; tokenProgram?: PublicKey }): TransactionInstruction {
  const tokenProgram = params.tokenProgram ?? SPL_TOKEN_PROGRAM;
  const ata = associatedTokenAddress(params.mint, params.owner, tokenProgram);
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** SPL Token SyncNative (tag 17): a wSOL account's token amount catches up with its lamports. */
export function syncNativeIx(account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: SPL_TOKEN_PROGRAM, keys: [{ pubkey: account, isSigner: false, isWritable: true }], data: Buffer.from([17]) });
}

/** SPL Token CloseAccount (tag 9): the account's lamports go to `destination` (a wSOL account closes to plain SOL). */
export function closeAccountIx(params: { account: PublicKey; destination: PublicKey; owner: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: SPL_TOKEN_PROGRAM,
    keys: [
      { pubkey: params.account, isSigner: false, isWritable: true },
      { pubkey: params.destination, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]),
  });
}

export function ownerInfoPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("OWNER_INFO")], programId);
  return pda;
}

export function buildActivateAtaInstruction(params: {
  programId: PublicKey; chainId: number | bigint; mint: PublicKey; tokens: bigint;
  signer: PublicKey; fromAta: PublicKey; toAta: PublicKey; tokenProgram: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: params.programId,
    keys: [
      { pubkey: params.signer, isSigner: true, isWritable: true },
      { pubkey: ownerInfoPda(params.programId), isSigner: false, isWritable: false },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.fromAta, isSigner: false, isWritable: true },
      { pubkey: params.toAta, isSigner: false, isWritable: true },
      { pubkey: params.tokenProgram, isSigner: false, isWritable: false },
    ],
    data: buildActivateAtaData({ chainId: params.chainId, mint: params.mint, tokens: params.tokens }),
  });
}
