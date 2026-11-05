// A LaneSigner over a Keypair — for harnesses and tests only. A wallet in the
// browser goes through lib/lane/walletStandard.ts; this signs the same two
// byte strings with the same key so the two paths cannot drift.
import { ed25519 } from "@noble/curves/ed25519";
import type { Keypair } from "@solana/web3.js";
import type { LaneSigner } from "@/lib/lane/walletStandard";
import { splitV1Wire } from "./v1Message";

export function keypairLaneSigner(kp: Keypair): LaneSigner {
  const secret = kp.secretKey.subarray(0, 32);
  return {
    payer: kp.publicKey,
    signAuthMessage: async (message) => ed25519.sign(message, secret),
    signV1Wire: async (wire) => {
      const { message } = splitV1Wire(wire);
      return ed25519.sign(message, secret);
    },
    signV1Wires: async (wires) => wires.map((wire) => ed25519.sign(splitV1Wire(wire).message, secret)),
  };
}
