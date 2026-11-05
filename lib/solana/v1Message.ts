// A SIMD-0385 v1 MESSAGE, decoded far enough to validate what the proxy
// composed BEFORE a wallet is asked to sign it: version byte, header, config
// mask (CU limit / heap live here, never in ComputeBudget instructions), the
// account list, and every instruction. Port of rome-arc
// arc/materialise/solana/submit.ts (parseV1Message and friends).
import { Buffer } from "buffer";
import { PublicKey, type AccountMeta, type TransactionInstruction } from "@solana/web3.js";

export const V1_VERSION_BYTE = 0x81;
const KNOWN_CONFIG_MASK_BITS = 0b11111;

export interface V1MessageHeader {
  numRequiredSignatures: number;
  numReadonlySignedAccounts: number;
  numReadonlyUnsignedAccounts: number;
}
export interface V1Instruction {
  programIdIndex: number;
  accountIndices: readonly number[];
  data: Uint8Array;
}
export interface ParsedV1Message {
  header: V1MessageHeader;
  accountKeys: PublicKey[];
  instructions: readonly V1Instruction[];
  computeUnitLimit?: number;
  heapBytes?: number;
}

function readBounded(buf: Buffer, off: number, n: number, what: string): void {
  if (off + n > buf.length) {
    throw new Error(
      `parseV1Message: truncated buffer reading ${what} (need ${n} byte(s) at offset ${off}, only ${Math.max(0, buf.length - off)} remain)`,
    );
  }
}

/** Split a composed v1 WIRE (`message ‖ n × 64-byte signature slots`) into its message. */
export function splitV1Wire(wire: Uint8Array): { message: Uint8Array; numRequiredSignatures: number } {
  if (wire.length < 2) throw new Error("splitV1Wire: wire too short");
  if (wire[0] !== V1_VERSION_BYTE) {
    throw new Error(`splitV1Wire: not a v1 wire (version byte 0x${wire[0]!.toString(16)}, expected 0x81)`);
  }
  const n = wire[1]!;
  const messageLen = wire.length - 64 * n;
  if (n < 1 || messageLen <= 0) throw new Error(`splitV1Wire: ${n} signature slot(s) do not fit a ${wire.length}-byte wire`);
  return { message: wire.subarray(0, messageLen), numRequiredSignatures: n };
}

export function parseV1Message(message: Uint8Array): ParsedV1Message {
  const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
  readBounded(buf, 0, 42, "the fixed header");
  if (buf[0] !== V1_VERSION_BYTE) {
    throw new Error(`parseV1Message: not a v1 message (version byte 0x${(buf[0] ?? 0).toString(16)}, expected 0x81)`);
  }
  const header: V1MessageHeader = {
    numRequiredSignatures: buf[1]!,
    numReadonlySignedAccounts: buf[2]!,
    numReadonlyUnsignedAccounts: buf[3]!,
  };
  const configMask = buf.readUInt32LE(4);
  if ((configMask & ~KNOWN_CONFIG_MASK_BITS) !== 0) {
    throw new Error(`parseV1Message: unknown config mask bits set (0b${configMask.toString(2)})`);
  }
  const priorityFeeBits = configMask & 0b11;
  if (priorityFeeBits !== 0 && priorityFeeBits !== 0b11) {
    throw new Error(`parseV1Message: invalid partial priority-fee bits (0b${configMask.toString(2)})`);
  }
  const numInstructions = buf[40]!;
  const numAddresses = buf[41]!;
  let off = 42;
  const accountKeys: PublicKey[] = [];
  for (let i = 0; i < numAddresses; i++) {
    readBounded(buf, off, 32, `account key ${i}`);
    accountKeys.push(new PublicKey(buf.subarray(off, off + 32)));
    off += 32;
  }
  if (priorityFeeBits === 0b11) { readBounded(buf, off, 8, "the priority-fee config value"); off += 8; }
  let computeUnitLimit: number | undefined;
  if ((configMask & 0b100) !== 0) { readBounded(buf, off, 4, "the compute-unit-limit config value"); computeUnitLimit = buf.readUInt32LE(off); off += 4; }
  if ((configMask & 0b1000) !== 0) { readBounded(buf, off, 4, "the loaded-accounts-data-size config value"); off += 4; }
  let heapBytes: number | undefined;
  if ((configMask & 0b10000) !== 0) { readBounded(buf, off, 4, "the heap-size config value"); heapBytes = buf.readUInt32LE(off); off += 4; }
  const headers: { programIdIndex: number; numAccounts: number; dataLen: number }[] = [];
  for (let i = 0; i < numInstructions; i++) {
    readBounded(buf, off, 4, `instruction ${i}'s header`);
    headers.push({ programIdIndex: buf[off]!, numAccounts: buf[off + 1]!, dataLen: buf.readUInt16LE(off + 2) });
    off += 4;
  }
  const instructions: V1Instruction[] = [];
  for (const [i, h] of headers.entries()) {
    readBounded(buf, off, h.numAccounts, `instruction ${i}'s account indices`);
    const accountIndices = [...buf.subarray(off, off + h.numAccounts)];
    off += h.numAccounts;
    readBounded(buf, off, h.dataLen, `instruction ${i}'s data`);
    const data = new Uint8Array(buf.subarray(off, off + h.dataLen));
    off += h.dataLen;
    instructions.push({ programIdIndex: h.programIdIndex, accountIndices, data });
  }
  return {
    header,
    accountKeys,
    instructions,
    ...(computeUnitLimit === undefined ? {} : { computeUnitLimit }),
    ...(heapBytes === undefined ? {} : { heapBytes }),
  };
}

function isWritableIndex(i: number, header: V1MessageHeader, numKeys: number): boolean {
  return (
    i < Math.max(0, header.numRequiredSignatures - header.numReadonlySignedAccounts) ||
    (i >= header.numRequiredSignatures && i < Math.max(0, numKeys - header.numReadonlyUnsignedAccounts))
  );
}

export function metasForInstruction(parsed: ParsedV1Message, ix: V1Instruction): AccountMeta[] {
  return ix.accountIndices.map((idx) => ({
    pubkey: parsed.accountKeys[idx]!,
    isSigner: idx < parsed.header.numRequiredSignatures,
    isWritable: isWritableIndex(idx, parsed.header, parsed.accountKeys.length),
  }));
}

export function accountsForProgram(parsed: ParsedV1Message, programId: PublicKey): AccountMeta[] | null {
  const ix = parsed.instructions.find((i) => parsed.accountKeys[i.programIdIndex]?.equals(programId));
  if (!ix) return null;
  return metasForInstruction(parsed, ix);
}

/**
 * Encode a v1 MESSAGE (the inverse of parseV1Message) for plain native
 * instructions the wallet signs itself — no priority fee, one signer (the
 * payer). v1 reads its limits from the config mask and an unset limit is ZERO,
 * so the compute-unit limit and the loaded-accounts-data limit are always set
 * (the proxy's composed txs use the same 64 MiB). Layout: version, header,
 * config mask, 32-byte blockhash, instruction + address counts, addresses
 * (signers first, writable before read-only), config values, instruction
 * headers, then each instruction's accounts + data.
 */
export const NATIVE_V1_COMPUTE_UNIT_LIMIT = 200_000;
export const NATIVE_V1_LOADED_ACCOUNTS_DATA_SIZE = 64 * 1024 * 1024;

export function encodeV1Message(p: {
  payer: PublicKey;
  recentBlockhash: Uint8Array;
  instructions: readonly TransactionInstruction[];
  computeUnitLimit?: number;
}): Uint8Array {
  if (p.recentBlockhash.length !== 32) throw new Error("encodeV1Message: the blockhash must be 32 bytes");
  const metas = new Map<string, { key: PublicKey; signer: boolean; writable: boolean }>();
  const touch = (key: PublicKey, signer: boolean, writable: boolean) => {
    const m = metas.get(key.toBase58());
    if (m) { m.signer ||= signer; m.writable ||= writable; } else metas.set(key.toBase58(), { key, signer, writable });
  };
  touch(p.payer, true, true);
  for (const ix of p.instructions) {
    touch(ix.programId, false, false);
    for (const k of ix.keys) touch(k.pubkey, k.isSigner, k.isWritable);
  }
  const all = [...metas.values()];
  const rank = (m: { signer: boolean; writable: boolean }) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3);
  const payerKey = p.payer.toBase58();
  // Array.sort is stable; the payer stays first among the writable signers.
  all.sort((a, b) => rank(a) - rank(b) || (a.key.toBase58() === payerKey ? -1 : b.key.toBase58() === payerKey ? 1 : 0));
  const index = new Map(all.map((m, i) => [m.key.toBase58(), i] as const));
  const signers = all.filter((m) => m.signer).length;
  if (signers !== 1) throw new Error(`encodeV1Message: expected one signer, got ${signers}`);
  const out: number[] = [
    V1_VERSION_BYTE, signers, all.filter((m) => m.signer && !m.writable).length, all.filter((m) => !m.signer && !m.writable).length,
    0b1100, 0, 0, 0, // config mask: compute-unit limit + loaded-accounts-data limit
    ...p.recentBlockhash,
    p.instructions.length, all.length,
  ];
  for (const m of all) out.push(...m.key.toBytes());
  const u32 = (n: number) => out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
  u32(p.computeUnitLimit ?? NATIVE_V1_COMPUTE_UNIT_LIMIT);
  u32(NATIVE_V1_LOADED_ACCOUNTS_DATA_SIZE);
  for (const ix of p.instructions) out.push(index.get(ix.programId.toBase58())!, ix.keys.length, ix.data.length & 0xff, ix.data.length >> 8);
  for (const ix of p.instructions) {
    for (const k of ix.keys) out.push(index.get(k.pubkey.toBase58())!);
    out.push(...ix.data);
  }
  return new Uint8Array(out);
}
