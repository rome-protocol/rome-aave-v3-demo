// tokenMeta.mjs — what a pasted token mint is called, from the chain. Pure decoding plus one read.
//   * decodeMint          : decimals from a mint account (classic or Token-2022).
//   * decodeMetaplex      : name and symbol from the Metaplex token-metadata account.
//   * decodeToken2022Meta : name and symbol from the Token-2022 metadata extension, when the mint carries one.
//   * readTokenMeta       : one getMultipleAccounts (the mint and its Metaplex metadata account) through the
//                           app's own RPC path (the site's /rpc relay), then the decode.
// The answer keeps "could not read the network" apart from "this is not a token mint": a failed read is never
// shown as an invalid address (rpcRead.mjs does the same for balances).
// Shared by the create, find and (next) pools screens. (Not named tokenMeta.ts alongside; see txWait.mjs.)

import { PublicKey } from "@solana/web3.js";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const METADATA_PROGRAM = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

const MINT_LEN = 82;
const TOKEN_2022_ACCOUNT_TYPE_OFFSET = 165; // Token-2022 pads a mint to 165 bytes, then one account-type byte, then TLV extensions
const TOKEN_METADATA_EXTENSION = 19;

const utf8 = new TextDecoder("utf-8", { fatal: false });
// Control characters plus the invisible ones that make two symbols look the same: soft hyphen, zero-width and
// direction marks (U+200B-U+200F), bidi embeddings and overrides (U+202A-U+202E), word joiner and invisible
// operators (U+2060-U+2064), the byte-order mark.
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const clean = (s) => s.replace(/\0+$/g, "").replace(/[\u0000-\u001f]/g, "").replace(INVISIBLE, "").trim();

/** Mint account data -> { decimals, isInitialized } or null when it is not a mint. */
export function decodeMint(data) {
  if (!data || data.length < MINT_LEN) return null;
  // A mint is exactly 82 bytes, or (Token-2022 with extensions) longer than 165 with account type 1 at byte 165.
  // A 165-byte token account is neither, so it is never read as a mint.
  const isMintShape = data.length === MINT_LEN || (data.length > TOKEN_2022_ACCOUNT_TYPE_OFFSET && data[TOKEN_2022_ACCOUNT_TYPE_OFFSET] === 1);
  if (!isMintShape) return null;
  const isInitialized = data[45] === 1;
  return isInitialized ? { decimals: data[44], isInitialized } : null;
}

// Borsh string: u32 LE length, then the bytes. Returns [text, nextOffset] or null when it runs past the data.
function readString(data, off) {
  if (off + 4 > data.length) return null;
  const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(off, true);
  if (len > 4096 || off + 4 + len > data.length) return null;
  return [clean(utf8.decode(data.subarray(off + 4, off + 4 + len))), off + 4 + len];
}

/** Metaplex metadata account (key 4) -> { name, symbol, uri } or null. Layout: key(1) update_authority(32) mint(32) name symbol uri. */
export function decodeMetaplex(data, mint) {
  if (!data || data.length < 1 + 32 + 32 + 12 || data[0] !== 4) return null;
  if (mint && Buffer.compare(Buffer.from(data.subarray(33, 65)), Buffer.from(new PublicKey(mint).toBytes())) !== 0) return null;
  const name = readString(data, 65);
  const symbol = name && readString(data, name[1]);
  const uri = symbol && readString(data, symbol[1]);
  return name && symbol ? { name: name[0], symbol: symbol[0], uri: uri ? uri[0] : "" } : null;
}

/** Token-2022 mint data -> { name, symbol, uri } from the metadata extension, or null when it has none. */
export function decodeToken2022Meta(data) {
  if (!data || data.length <= TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let off = TOKEN_2022_ACCOUNT_TYPE_OFFSET + 1;
  while (off + 4 <= data.length) {
    const type = view.getUint16(off, true), len = view.getUint16(off + 2, true);
    const body = off + 4;
    if (body + len > data.length) return null;
    if (type === TOKEN_METADATA_EXTENSION) {
      // update_authority(32) mint(32) name symbol uri ...
      const name = readString(data, body + 64);
      const symbol = name && readString(data, name[1]);
      const uri = symbol && readString(data, symbol[1]);
      return name && symbol ? { name: name[0], symbol: symbol[0], uri: uri ? uri[0] : "" } : null;
    }
    off = body + len;
  }
  return null;
}

/** The Metaplex metadata account address of a mint. */
export function metadataAddress(mint) {
  const m = new PublicKey(mint);
  return PublicKey.findProgramAddressSync([Buffer.from("metadata"), new PublicKey(METADATA_PROGRAM).toBuffer(), m.toBuffer()], new PublicKey(METADATA_PROGRAM))[0].toBase58();
}

/** "K9Hem…i633": the short form of a mint, the last resort name. */
export const shortMint = (mint) => (mint.length > 10 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint);

/** What to call a token: its symbol, else its name, else the short mint. `configured` is the app's own tokens
 *  ({ symbol, mint }): when the symbol read from the chain is the symbol of a configured token that this mint is NOT,
 *  the short mint is added ("USDC (CLZW…kvVH)") so the two are never taken for each other. */
export function displaySymbol({ symbol, name, mint }, configured = []) {
  const base = (symbol && clean(symbol)) || (name && clean(name)) || shortMint(mint);
  const fold = (x) => x.normalize("NFKC").toLowerCase();
  const clash = configured.some((t) => t.mint !== mint && fold(t.symbol) === fold(base));
  return clash ? `${base} (${shortMint(mint)})` : base;
}

const b64 = (v) => (typeof v?.data?.[0] === "string" ? Uint8Array.from(Buffer.from(v.data[0], "base64")) : null);

/**
 * @typedef {{ kind: "token", mint: string, decimals: number, symbol: string, name: string, uri: string, program: "token" | "token-2022", source: "metaplex" | "token-2022" | "mint" }} TokenRead
 * @typedef {{ kind: "not-a-mint", why: "address" | "missing" | "owner" | "data" }} NotAMint
 * @typedef {{ kind: "unreadable" }} Unreadable
 */

/**
 * Read a pasted mint.
 * Returns one of
 *   { kind: "token", mint, decimals, symbol, name, program: "token"|"token-2022", source: "metaplex"|"token-2022"|"mint" }
 *   { kind: "not-a-mint", why: "address" | "missing" | "owner" | "data" }   the read worked; this is not a token mint
 *   { kind: "unreadable" }                                                  the network could not answer
 * `rpcUrl` is the app's Solana RPC (the site's /rpc relay); `fetchImpl` is injectable for tests.
 */
/** @param {{ rpcUrl: string, mint: string, fetchImpl?: typeof fetch }} args
 *  @returns {Promise<TokenRead | NotAMint | Unreadable>} */
export async function readTokenMeta({ rpcUrl, mint, fetchImpl = globalThis.fetch }) {
  const m = String(mint ?? "").trim();
  let meta;
  try { meta = metadataAddress(m); } catch { return { kind: "not-a-mint", why: "address" }; }
  let body;
  try {
    const res = await fetchImpl(rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getMultipleAccounts", params: [[m, meta], { encoding: "base64", commitment: "confirmed" }] }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok || body?.error || !Array.isArray(body?.result?.value)) return { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
  const [mintAcc, metaAcc] = body.result.value;
  if (!mintAcc) return { kind: "not-a-mint", why: "missing" };
  const owner = mintAcc.owner;
  if (owner !== TOKEN_PROGRAM && owner !== TOKEN_2022_PROGRAM) return { kind: "not-a-mint", why: "owner" };
  const data = b64(mintAcc);
  const dec = decodeMint(data);
  if (!dec) return { kind: "not-a-mint", why: "data" };
  const program = owner === TOKEN_2022_PROGRAM ? "token-2022" : "token";
  let found = null, source = "mint";
  const mp = metaAcc && metaAcc.owner === METADATA_PROGRAM ? decodeMetaplex(b64(metaAcc), m) : null;
  if (mp && (mp.symbol || mp.name)) { found = mp; source = "metaplex"; }
  if (!found && program === "token-2022") {
    const t = decodeToken2022Meta(data);
    if (t && (t.symbol || t.name)) { found = t; source = "token-2022"; }
  }
  return { kind: "token", mint: m, decimals: dec.decimals, symbol: found?.symbol ?? "", name: found?.name ?? "", uri: found?.uri ?? "", program, source };
}
