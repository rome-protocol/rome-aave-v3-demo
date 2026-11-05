// Who a token is, read from the mint. One order:
//   (a) the Rome registry (rome-protocol/registry), by mint: chains/<dir>/tokens.json (mintId, assetRef) -> assets/<assetRef>.json
//       (symbol, name, logoURI: a registry path like assets/usdc.svg, or an https URL);
//   (b) when the registry has no logo for it (or no credentials are set, as in CI): Jupiter's verified token list, by mint (the shared
//       token-list icons Orca shows): an entry whose id is the mint and that is verified gives its icon, symbol and name;
//   (c) when Jupiter has no such verified entry: the mint's own on-chain metadata (Metaplex or Token-2022: name, symbol, uri), and when
//       the uri is https, the image its JSON names;
//   (d) when none has a logo: no logo. The client draws a letter.
// Logos are served from the app's own origin (the route), image bytes sniffed, size capped, https-only hosts. The page never loads
// an image from a third party. Answers are kept for ten minutes, with a stale copy of a day for when the source does not answer.
// No Next.js imports.
import { displaySymbol, readTokenMeta } from "../tokenMeta.mjs";
import { fetchCapped, isLogoUrl, sniffImage, Refused, JSON_MAX_BYTES, LOGO_MAX_BYTES } from "./logoFetch.mjs";
import { createStaleCache } from "./staleCache.mjs";
import { createJupiterList } from "./jupiterList.mjs";
import { isRegistryPath, registryDirOf } from "./registry.mjs";

export const IDENTITY_TTL_MS = 10 * 60_000;
export const STALE_MS = 24 * 3600_000;
/** Logos are read by every page, a dozen or more at a time, and kept by the browser for an hour: a client that asks far more than that is not a page. */
export const LOGO_LIMIT = { max: 300, windowMs: 60_000 };
export const LOGO_BROWSER_TTL_SECONDS = 3600;

const MINT_SHAPE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isMintShape = (s) => typeof s === "string" && MINT_SHAPE.test(s);

// The failures carry a `code` as well as a class: the service is kept on globalThis and each route can bundle its own copy of this file,
// so `instanceof` across routes is not reliable (failureStatus in tokenApi.mjs reads the code).
/** The token is not there to read (not a mint): the route answers 404. */
export class NotAToken extends Error { code = "not-a-token"; }
/** The sources did not answer and no copy is kept: the route answers 503. */
export class Unavailable extends Error { code = "unavailable"; }

/**
 * @param {{
 *   registry: null | { tokens(dir: string): Promise<any[] | null>, asset(ref: string): Promise<any | null>, file(path: string): Promise<Uint8Array | null> },
 *   jupiter?: null | { token(mint: string): Promise<null | { symbol: string, name: string, icon: string }> },  (default: Jupiter's verified list; null for none)
 *   readMeta?: (chain: { chainId: string, solanaRpc: string }, mint: string) => Promise<any>,
 *   fetch?: typeof fetch, lookup?: any, now?: () => number, log?: (event: string, fields?: Record<string, unknown>) => void,
 * }} deps
 */
export function createTokenService(deps) {
  const { registry } = deps;
  const log = deps.log ?? (() => undefined);
  const fetchOpts = { fetch: deps.fetch, lookup: deps.lookup };
  // The on-chain read goes to the chain's Solana RPC (the same upstream the app's /api/solana-rpc forwards to).
  const readMeta = deps.readMeta ?? ((chain, mint) => readTokenMeta({ rpcUrl: chain.solanaRpc, mint, fetchImpl: deps.fetch }));
  const jupiter = deps.jupiter === undefined ? createJupiterList({ fetch: deps.fetch, lookup: deps.lookup, now: deps.now, log }) : deps.jupiter;
  const cacheOpts = { ttlMs: IDENTITY_TTL_MS, staleMs: STALE_MS, now: deps.now };
  const lists = createStaleCache({ ...cacheOpts, maxEntries: 50 });
  const assets = createStaleCache({ ...cacheOpts, maxEntries: 200 });
  const records = createStaleCache({ ...cacheOpts, maxEntries: 2000 });
  const logos = createStaleCache({ ...cacheOpts, maxEntries: 300 });

  /** The image a token's metadata JSON names, when its uri is https; null otherwise or when the JSON says nothing usable. */
  async function metadataImage(uri) {
    if (!uri || !isLogoUrl(uri)) return null;
    try {
      const bytes = await fetchCapped(uri, { ...fetchOpts, maxBytes: JSON_MAX_BYTES, accept: "application/json" });
      if (!bytes) return null;
      const body = JSON.parse(new TextDecoder().decode(bytes));
      const image = typeof body?.image === "string" ? body.image.trim() : "";
      return image && isLogoUrl(image) ? image : null;
    } catch (e) {
      if (!(e instanceof Refused)) log("token metadata not read", { reason: e instanceof Error ? e.message : "error" });
      return null;
    }
  }

  /** The registry's entry for a mint, with its asset; null when there is no registry or it has no such token. A registry that fails is the same as none. */
  async function fromRegistry(chain, mint) {
    if (!registry) return null;
    try {
      const dir = registryDirOf(chain);
      const list = await lists.get(dir, async () => (await registry.tokens(dir)) ?? []);
      const mine = list.filter((t) => t && t.mintId === mint);
      const entry = mine.find((t) => t.assetRef) ?? mine[0];
      if (!entry) return null;
      const asset = entry.assetRef ? await assets.get(entry.assetRef, () => registry.asset(entry.assetRef)) : null;
      return { entry, asset };
    } catch (e) {
      log("registry not read", { reason: e instanceof Error ? e.message : "error" });
      return null;
    }
  }

  /** The record of a token: { mint, symbol, name, source, logo: null | { kind: "registry" | "image", uri } }. */
  async function loadRecord(chain, mint) {
    const hit = await fromRegistry(chain, mint);
    const regSymbol = hit?.asset?.symbol || hit?.entry?.symbol || "";
    const regName = hit?.asset?.name || hit?.entry?.name || "";
    const regLogo = typeof hit?.asset?.logoURI === "string" && hit.asset.logoURI.trim() ? { kind: "registry", uri: hit.asset.logoURI.trim() } : null;
    if (hit && regSymbol && regLogo) return { mint, symbol: regSymbol, name: regName, source: "registry", logo: regLogo };

    // Jupiter's verified list, by mint. It never fails the read: a Jupiter that does not answer is a miss.
    let jup = null;
    if (jupiter) {
      try { jup = await jupiter.token(mint); } catch { jup = null; }
    }
    if (jup) {
      const logo = regLogo ?? { kind: "image", uri: jup.icon };
      if (hit && regSymbol) return { mint, symbol: regSymbol, name: regName, source: "registry", logo };
      return { mint, symbol: jup.symbol, name: jup.name, source: "jupiter", logo };
    }

    const meta = await readMeta(chain, mint);
    if (meta.kind === "unreadable") {
      if (hit && regSymbol) return { mint, symbol: regSymbol, name: regName, source: "registry", logo: null };
      throw new Unavailable("the token could not be read");
    }
    if (meta.kind !== "token") {
      if (hit && regSymbol) return { mint, symbol: regSymbol, name: regName, source: "registry", logo: null };
      throw new NotAToken("not a token mint");
    }
    const image = await metadataImage(meta.uri);
    const logo = regLogo ?? (image ? { kind: "image", uri: image } : null);
    if (hit && regSymbol) return { mint, symbol: regSymbol, name: regName, source: "registry", logo };
    const symbol = displaySymbol({ symbol: meta.symbol, name: meta.name, mint });
    return { mint, symbol, name: meta.name || "", source: meta.symbol || meta.name ? "chain" : "none", logo };
  }

  const record = (chain, mint) => {
    if (!isMintShape(mint)) throw new NotAToken("not a token mint");
    return records.get(`${chain.chainId}:${mint}`, () => loadRecord(chain, mint));
  };

  async function loadLogo(chain, mint) {
    const rec = await record(chain, mint);
    if (!rec.logo) return { none: true };
    const { kind, uri } = rec.logo;
    let bytes;
    try {
      if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) bytes = await fetchCapped(uri, { ...fetchOpts, accept: "image/*" });
      else if (kind === "registry" && registry && isRegistryPath(uri)) bytes = await registry.file(uri);
      else bytes = null;
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      log("logo refused", { mint, reason: e.message });
      return { none: true };
    }
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > LOGO_MAX_BYTES) return { none: true };
    const type = sniffImage(bytes);
    if (!type) {
      log("logo is not an image", { mint });
      return { none: true };
    }
    return { type, b64: Buffer.from(bytes).toString("base64") };
  }

  return {
    /** { mint, symbol, name, source, logo: boolean } for a mint. Throws NotAToken or Unavailable. */
    async identity(chain, mint) {
      const r = await record(chain, mint);
      return { mint: r.mint, symbol: r.symbol, name: r.name, source: r.source, logo: r.logo !== null };
    },
    /** { type, body } of a token's logo, or null when it has none (or what it names is not an image). Throws NotAToken or Unavailable. */
    async logo(chain, mint) {
      if (!isMintShape(mint)) throw new NotAToken("not a token mint");
      const stored = await logos.get(`${chain.chainId}:${mint}`, () => loadLogo(chain, mint));
      return "none" in stored ? null : { type: stored.type, body: Buffer.from(stored.b64, "base64") };
    },
  };
}
