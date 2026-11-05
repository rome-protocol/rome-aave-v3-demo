// Jupiter's verified token list, read by mint: the same shared token-list icons Orca and Jupiter show (a square 512x512 icon that fills a
// circle cleanly). Only an entry whose id is the mint and that Jupiter marks verified is taken (icon, symbol, name). Server-side only,
// through the same guards as every logo read (https only, public address, size cap, redirect limit) and the project User-Agent. A hit is
// kept for a day, a miss for a few minutes, and a Jupiter that does not answer is a miss for a minute: it never fails the caller.
// No Next.js imports.
import { fetchCapped, isLogoUrl, Refused } from "./logoFetch.mjs";

export const JUPITER_SEARCH_URL = "https://lite-api.jup.ag/tokens/v2/search";
export const JUPITER_HIT_TTL_MS = 24 * 3600_000;
export const JUPITER_MISS_TTL_MS = 5 * 60_000;
export const JUPITER_DOWN_TTL_MS = 60_000;
/** A search answer for one mint is a few kilobytes (price and volume stats included). */
export const JUPITER_MAX_BYTES = 256 * 1024;

const text = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * @param {{ fetch?: typeof fetch, lookup?: any, now?: () => number, log?: (event: string, fields?: Record<string, unknown>) => void, maxEntries?: number }} [deps]
 * @returns {{ token(mint: string): Promise<null | { symbol: string, name: string, icon: string }> }}
 */
export function createJupiterList(deps = {}) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const maxEntries = deps.maxEntries ?? 2000;
  /** @type {Map<string, { value: any, until: number }>} */
  const kept = new Map();
  /** @type {Map<string, Promise<any>>} */
  const running = new Map();

  function keep(mint, value, ttl) {
    kept.delete(mint);
    kept.set(mint, { value, until: now() + ttl });
    while (kept.size > maxEntries) kept.delete(kept.keys().next().value);
    return value;
  }

  async function read(mint) {
    try {
      const bytes = await fetchCapped(`${JUPITER_SEARCH_URL}?query=${encodeURIComponent(mint)}`, { fetch: deps.fetch, lookup: deps.lookup, maxBytes: JUPITER_MAX_BYTES, accept: "application/json" });
      if (!bytes) return keep(mint, null, JUPITER_MISS_TTL_MS);
      const list = JSON.parse(new TextDecoder().decode(bytes));
      const hit = Array.isArray(list) ? list.find((t) => t && t.id === mint && t.isVerified === true) : null;
      const icon = text(hit?.icon, 2048);
      const symbol = text(hit?.symbol, 32);
      if (!hit || !symbol || !icon || !isLogoUrl(icon)) return keep(mint, null, JUPITER_MISS_TTL_MS);
      return keep(mint, { symbol, name: text(hit.name, 64), icon }, JUPITER_HIT_TTL_MS);
    } catch (e) {
      // Down, slow, refused or not JSON: skipped like a registry miss, tried again in a minute.
      if (!(e instanceof Refused)) log("jupiter list not read", { reason: e instanceof Error ? e.message : "error" });
      return keep(mint, null, JUPITER_DOWN_TTL_MS);
    }
  }

  return {
    async token(mint) {
      const copy = kept.get(mint);
      if (copy && copy.until > now()) return copy.value;
      let p = running.get(mint);
      if (!p) {
        p = read(mint);
        running.set(mint, p);
        const free = () => { if (running.get(mint) === p) running.delete(mint); };
        p.then(free, free);
      }
      return p;
    },
  };
}
