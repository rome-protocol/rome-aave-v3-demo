import { test } from "vitest";
import assert from "node:assert/strict";
import { createTokenService } from "./tokenService.mjs";
import { createJupiterList, JUPITER_HIT_TTL_MS, JUPITER_MISS_TTL_MS, JUPITER_DOWN_TTL_MS } from "./jupiterList.mjs";

// Jupiter's verified token list, the source of the shared token-list icons Orca shows (identity order: registry, Jupiter, chain, letter).

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const SOL_ICON = "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png";
const chain = { chainId: "200010", name: "Hadrian", solanaRpc: "unused" };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const publicLookup = async () => [{ address: "93.184.216.34" }];
const res = (body, init = {}) => new Response(body, { status: 200, ...init });
const noChainRead = async () => { throw new Error("the chain must not be read"); };
const solMeta = async () => ({ kind: "token", mint: SOL, decimals: 9, symbol: "WSOL", name: "Wrapped SOL (chain)", uri: "", program: "token", source: "mint" });

const jupEntry = (over = {}) => ({ id: SOL, name: "Wrapped SOL", symbol: "SOL", icon: SOL_ICON, isVerified: true, ...over });

/** A fetch that answers Jupiter's search with `list` (or an outage), and every other URL with a PNG; records every URL asked. */
function jupFetch(list, seen = []) {
  return async (url) => {
    seen.push(String(url));
    if (String(url).startsWith("https://lite-api.jup.ag/tokens/v2/search?query=")) {
      if (list === "down") return res("", { status: 503 });
      return res(JSON.stringify(list));
    }
    return res(PNG);
  };
}
function fakeRegistry({ tokens = [], assets = {}, files = {} } = {}) {
  return { tokens: async () => tokens, asset: async (ref) => assets[ref] ?? null, file: async (path) => files[path] ?? null };
}
const solRegistry = (over = {}) => fakeRegistry({ tokens: [{ mintId: SOL, symbol: "SOL", assetRef: "sol" }], assets: { sol: { symbol: "SOL", name: "Solana", logoURI: "assets/sol.png", ...over } }, files: { "assets/sol.png": PNG } });
const make = (deps) => createTokenService({ lookup: publicLookup, ...deps });

test("order: a registry hit with a logo wins; Jupiter is not asked", async () => {
  const seen = [];
  const svc = make({ registry: solRegistry(), readMeta: noChainRead, fetch: jupFetch([jupEntry()], seen) });
  assert.deepEqual(await svc.identity(chain, SOL), { mint: SOL, symbol: "SOL", name: "Solana", source: "registry", logo: true });
  assert.equal((await svc.logo(chain, SOL)).type, "image/png");
  assert.deepEqual(seen, []);
});

test("order: no registry entry, a verified Jupiter hit gives icon, symbol and name; the chain is not read; the icon goes through the guards", async () => {
  const seen = [];
  const svc = make({ registry: null, readMeta: noChainRead, fetch: jupFetch([jupEntry()], seen) });
  assert.deepEqual(await svc.identity(chain, SOL), { mint: SOL, symbol: "SOL", name: "Wrapped SOL", source: "jupiter", logo: true });
  assert.equal((await svc.logo(chain, SOL)).type, "image/png");
  assert.deepEqual(seen, [`https://lite-api.jup.ag/tokens/v2/search?query=${SOL}`, SOL_ICON]);
});

test("order: a registry entry without a logo keeps its symbol and takes Jupiter's icon", async () => {
  const svc = make({ registry: solRegistry({ logoURI: undefined }), readMeta: noChainRead, fetch: jupFetch([jupEntry({ symbol: "WSOL" })]) });
  assert.deepEqual(await svc.identity(chain, SOL), { mint: SOL, symbol: "SOL", name: "Solana", source: "registry", logo: true });
});

test("order: an unverified Jupiter entry, one for another mint, one with a non-https icon, or none is ignored; the mint's own metadata answers", async () => {
  const lists = [[jupEntry({ isVerified: false })], [jupEntry({ isVerified: undefined })], [jupEntry({ id: USDC })], [jupEntry({ icon: "http://x.example.com/a.png" })], []];
  for (const list of lists) {
    const svc = make({ registry: null, readMeta: solMeta, fetch: jupFetch(list) });
    assert.deepEqual(await svc.identity(chain, SOL), { mint: SOL, symbol: "WSOL", name: "Wrapped SOL (chain)", source: "chain", logo: false });
  }
});

test("order: Jupiter down (503, not JSON, an exception) never fails the read; it falls to the chain, then to a letter", async () => {
  const bad = [jupFetch("down"), async () => res("<html>oops</html>"), async () => { throw new Error("offline"); }];
  for (const fetch of bad) {
    const svc = make({ registry: null, readMeta: solMeta, fetch });
    assert.deepEqual(await svc.identity(chain, SOL), { mint: SOL, symbol: "WSOL", name: "Wrapped SOL (chain)", source: "chain", logo: false });
    assert.equal(await svc.logo(chain, SOL), null);
  }
});

test("Jupiter list: the request names the project contact and goes through the host guards", async () => {
  let headers;
  const list = createJupiterList({ fetch: async (_u, init) => { headers = init.headers; return res(JSON.stringify([jupEntry()])); }, lookup: publicLookup });
  assert.equal((await list.token(SOL)).symbol, "SOL");
  assert.equal(headers["user-agent"], "Rome Protocol rome@romeprotocol.com");
  const refused = createJupiterList({ fetch: async () => res(JSON.stringify([jupEntry()])), lookup: async () => [{ address: "10.0.0.5" }] });
  assert.equal(await refused.token(SOL), null);
});

test("Jupiter list: a hit is kept a day, a miss a few minutes, an outage a minute", async () => {
  let t = 0, calls = 0, answer = [jupEntry()];
  const fetch = async () => { calls++; return answer === "down" ? res("", { status: 500 }) : res(JSON.stringify(answer)); };
  const hits = createJupiterList({ fetch, lookup: publicLookup, now: () => t });
  await hits.token(SOL); await hits.token(SOL);
  assert.equal(calls, 1);
  t = JUPITER_HIT_TTL_MS - 1; await hits.token(SOL);
  assert.equal(calls, 1);
  t = JUPITER_HIT_TTL_MS + 1; answer = []; assert.equal(await hits.token(SOL), null);
  assert.equal(calls, 2);

  calls = 0; t = 0;
  const miss = createJupiterList({ fetch, lookup: publicLookup, now: () => t });
  await miss.token(SOL); await miss.token(SOL);
  assert.equal(calls, 1);
  t = JUPITER_MISS_TTL_MS + 1; answer = "down"; await miss.token(SOL);
  assert.equal(calls, 2);
  assert.equal(await miss.token(SOL), null); // the outage is kept as a miss
  assert.equal(calls, 2);
  t += JUPITER_DOWN_TTL_MS + 1; answer = [jupEntry()];
  assert.equal((await miss.token(SOL)).symbol, "SOL"); // a minute later it asks again and recovers
  assert.equal(calls, 3);
});
