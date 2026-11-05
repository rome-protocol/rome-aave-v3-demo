// The Solana lane's EVM identity. rome-evm derives it on chain from the Solana
// signer of the enclosing transaction: keccak256(pubkey)[12..32]. This must stay
// byte-compatible with the program (the test pins a vector cross-checked with
// `cast keccak`).
import { keccak256 } from "viem";
import { PublicKey } from "@solana/web3.js";

export type SolanaPubkeyInput = Uint8Array | PublicKey | string;

function pubkeyBytes(pubkey: SolanaPubkeyInput): Uint8Array {
  if (pubkey instanceof Uint8Array) return pubkey;
  if (typeof pubkey === "string") return new PublicKey(pubkey).toBytes();
  return pubkey.toBytes();
}

export function syntheticAddress(pubkey: SolanaPubkeyInput): `0x${string}` {
  const bytes = pubkeyBytes(pubkey);
  if (bytes.length !== 32) throw new Error(`syntheticAddress: expected a 32-byte Solana public key, got ${bytes.length} bytes`);
  return `0x${keccak256(bytes).slice(-40)}`;
}
