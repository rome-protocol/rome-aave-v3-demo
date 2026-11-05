import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import { hexToBytes, type Hex } from "viem";

export const SPL_TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");

/** rome-evm's signing authority for an EVM address: seeds ["EXTERNAL_AUTHORITY", addr]. The synthetic's SPL sits in this PDA's ATA. */
export function externalAuthPda(programId: PublicKey, address: Hex): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("EXTERNAL_AUTHORITY"), Buffer.from(hexToBytes(address))], programId);
  return pda;
}

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey = SPL_TOKEN_PROGRAM): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync([owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
  return ata;
}
