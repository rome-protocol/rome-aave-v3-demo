import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { syntheticAddress } from "./identity";

// keccak256(bytes(55R41dbR…)) computed independently with foundry `cast keccak`
// over the base58-decoded key 0x3c90443a…a47d → last 20 bytes.
const KEY = "55R41dbRU13QhLpAgha1841wR5M6sAcZhXd4S1LGupBn";
const SYNTH = "0xd868eec27e47376e739d0a3555f81b7657faa322";

describe("syntheticAddress", () => {
  it("derives keccak256(pubkey)[12..32] — pinned vector", () => {
    expect(syntheticAddress(KEY)).toBe(SYNTH);
    expect(syntheticAddress(new PublicKey(KEY))).toBe(SYNTH);
    expect(syntheticAddress(new PublicKey(KEY).toBytes())).toBe(SYNTH);
  });
  it("refuses anything that is not 32 bytes", () => {
    expect(() => syntheticAddress(new Uint8Array(31))).toThrow(/32-byte/);
  });
});
