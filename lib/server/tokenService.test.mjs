import { test } from "vitest";
import assert from "node:assert/strict";
import { createTokenService as createRealTokenService, NotAToken, Unavailable } from "./tokenService.mjs";

// These tests are about the registry and the chain: Jupiter is off here (its order is pinned in jupiterList.test.mjs), so none reaches the network.
const createTokenService = (deps) => createRealTokenService({ jupiter: null, ...deps });
import { sniffImage, isLogoUrl, isPublicAddress, fetchCapped, Refused, LOGO_MAX_BYTES } from "./logoFetch.mjs";
import { createRateLimiter, clientKey } from "./rateLimit.mjs";
import { createStaleCache } from "./staleCache.mjs";
import { registryDirOf, isRegistryPath, isAssetRef } from "./registry.mjs";
import { registryAuthFromEnv, patAuth } from "./registryAuth.mjs";

const USDC = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const OTHER = "K9HemYhgmNdnXLGRvk3xNBGHvEC4pDUHYYDVvbmMi633";
const chain = { chainId: "200010", name: "Hadrian", solanaRpc: "unused" };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const publicLookup = async () => [{ address: "93.184.216.34" }];

/** A registry with one chain folder and the assets given. */
function fakeRegistry({ tokens = [], assets = {}, files = {} } = {}) {
  const calls = { tokens: 0, asset: 0, file: 0 };
  return {
    calls,
    tokens: async () => { calls.tokens++; return tokens; },
    asset: async (ref) => { calls.asset++; return assets[ref] ?? null; },
    file: async (path) => { calls.file++; return files[path] ?? null; },
  };
}
const res = (body, init = {}) => new Response(body, { status: 200, ...init });
const noChainRead = async () => { throw new Error("the chain must not be read for a registry hit"); };

test("registry hit: symbol, name and a registry-stored logo come from the registry; the chain is never read", async () => {
  const registry = fakeRegistry({
    tokens: [{ mintId: USDC, symbol: "wUSDC", assetRef: "usdc" }],
    assets: { usdc: { symbol: "USDC", name: "USD Coin", logoURI: "assets/usdc.svg" } },
    files: { "assets/usdc.svg": SVG },
  });
  const svc = createTokenService({ registry, readMeta: noChainRead, lookup: publicLookup });
  assert.deepEqual(await svc.identity(chain, USDC), { mint: USDC, symbol: "USDC", name: "USD Coin", source: "registry", logo: true });
  const logo = await svc.logo(chain, USDC);
  assert.equal(logo.type, "image/svg+xml");
  assert.equal(registry.calls.file, 1);
  await svc.logo(chain, USDC); // the second read is a kept copy
  assert.equal(registry.calls.file, 1);
});

test("registry hit with an https logo URL: fetched from that host only", async () => {
  const seen = [];
  const fetch = async (url) => { seen.push(String(url)); return res(PNG); };
  const registry = fakeRegistry({ tokens: [{ mintId: USDC, assetRef: "usdc" }], assets: { usdc: { symbol: "USDC", name: "USD Coin", logoURI: "https://cdn.example.com/usdc.png" } } });
  const svc = createTokenService({ registry, readMeta: noChainRead, fetch, lookup: publicLookup });
  assert.equal((await svc.logo(chain, USDC)).type, "image/png");
  assert.deepEqual(seen, ["https://cdn.example.com/usdc.png"]);
});

test("registry has no entry: the mint's own on-chain metadata gives the name, and its https JSON gives the image", async () => {
  const registry = fakeRegistry({ tokens: [{ mintId: USDC, assetRef: "usdc" }], assets: { usdc: { symbol: "USDC", logoURI: "assets/usdc.svg" } } });
  const readMeta = async () => ({ kind: "token", mint: OTHER, decimals: 6, symbol: "TRDA", name: "Test A", uri: "https://meta.example.com/a.json", program: "token", source: "metaplex" });
  const fetch = async (url) => String(url).endsWith(".json") ? res(JSON.stringify({ image: "https://img.example.com/a.png" })) : res(PNG);
  const svc = createTokenService({ registry, readMeta, fetch, lookup: publicLookup });
  assert.deepEqual(await svc.identity(chain, OTHER), { mint: OTHER, symbol: "TRDA", name: "Test A", source: "chain", logo: true });
  assert.equal((await svc.logo(chain, OTHER)).type, "image/png");
});

test("no registry credentials: the same on-chain path answers (CI, a local run)", async () => {
  const readMeta = async () => ({ kind: "token", mint: OTHER, decimals: 6, symbol: "TRDA", name: "Test A", uri: "ipfs://abc", program: "token", source: "metaplex" });
  const svc = createTokenService({ registry: null, readMeta, lookup: publicLookup });
  assert.deepEqual(await svc.identity(chain, OTHER), { mint: OTHER, symbol: "TRDA", name: "Test A", source: "chain", logo: false });
  assert.equal(await svc.logo(chain, OTHER), null); // an ipfs uri is not https: no logo, a letter
});

test("neither source has a logo: no logo; a mint with no metadata is named by its short address", async () => {
  const readMeta = async () => ({ kind: "token", mint: OTHER, decimals: 6, symbol: "", name: "", uri: "", program: "token", source: "mint" });
  const svc = createTokenService({ registry: null, readMeta });
  const id = await svc.identity(chain, OTHER);
  assert.equal(id.symbol, "K9He…i633");
  assert.equal(id.source, "none");
  assert.equal(id.logo, false);
  assert.equal(await svc.logo(chain, OTHER), null);
});

test("a registry that does not answer is the same as none; an address that is not a mint is refused; a network that does not answer is unavailable", async () => {
  const broken = { tokens: async () => { throw new Error("down"); }, asset: async () => null, file: async () => null };
  const readMeta = async () => ({ kind: "token", mint: OTHER, decimals: 6, symbol: "X", name: "", uri: "", program: "token", source: "metaplex" });
  assert.equal((await createTokenService({ registry: broken, readMeta }).identity(chain, OTHER)).symbol, "X");
  await assert.rejects(createTokenService({ registry: null, readMeta }).identity(chain, "not a mint"), NotAToken);
  await assert.rejects(createTokenService({ registry: null, readMeta: async () => ({ kind: "not-a-mint", why: "missing" }) }).identity(chain, OTHER), NotAToken);
  await assert.rejects(createTokenService({ registry: null, readMeta: async () => ({ kind: "unreadable" }) }).identity(chain, OTHER), Unavailable);
});

test("the failures carry a code the routes read (instanceof is not reliable across bundled routes)", async () => {
  await assert.rejects(createTokenService({ registry: null }).identity(chain, "x"), (e) => e.code === "not-a-token");
  await assert.rejects(createTokenService({ registry: null, readMeta: async () => ({ kind: "unreadable" }) }).identity(chain, OTHER), (e) => e.code === "unavailable");
});

test("a logo that is not an image, or is too large, is no logo", async () => {
  const mk = (bytes) => createTokenService({
    registry: fakeRegistry({ tokens: [{ mintId: USDC, assetRef: "usdc" }], assets: { usdc: { symbol: "USDC", logoURI: "assets/usdc.svg" } }, files: { "assets/usdc.svg": bytes } }),
    readMeta: noChainRead,
  });
  assert.equal(await mk(new TextEncoder().encode("<html>not an image</html>")).logo(chain, USDC), null);
  assert.equal(await mk(new Uint8Array(LOGO_MAX_BYTES + 1).fill(0x41)).logo(chain, USDC), null);
});

test("a configured token's registry data wins; the symbol the registry gave is by mint, not by symbol text", async () => {
  const registry = fakeRegistry({ tokens: [{ mintId: USDC, symbol: "wUSDC", name: "Rome USDC", assetRef: "usdc" }, { mintId: USDC, symbol: "USDC", assetRef: "usdc" }], assets: { usdc: { symbol: "USDC", name: "USD Coin" } } });
  const svc = createTokenService({ registry, readMeta: async () => ({ kind: "not-a-mint", why: "missing" }) });
  const id = await svc.identity(chain, USDC);
  assert.equal(id.symbol, "USDC");
  assert.equal(id.name, "USD Coin");
  assert.equal(id.logo, false); // the asset names no logo and the chain has none: a letter
});

// ---- the logo guards ----

test("sniffImage reads the type from the bytes", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(SVG), "image/svg+xml");
  assert.equal(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImage(new TextEncoder().encode("<script>alert(1)</script>")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<html><svg></svg></html>")), null);
  assert.equal(sniffImage(new TextEncoder().encode('<?xml version="1.0"?>\n<!-- a -->\n<!DOCTYPE svg>\n<SVG viewBox="0 0 1 1"/>')), "image/svg+xml");
  assert.equal(sniffImage(new TextEncoder().encode("<!-- never closed <svg>")), null);
});

test("isLogoUrl: https and a host name only", () => {
  assert.equal(isLogoUrl("https://cdn.example.com/a.png"), true);
  for (const bad of ["http://cdn.example.com/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://localhost/a.png", "https://user:pw@cdn.example.com/a.png", "ftp://x.example.com/a", "https://metadata.internal/a", "not a url", "https://intranet/a.png"]) {
    assert.equal(isLogoUrl(bad), false, bad);
  }
});

test("isPublicAddress refuses private, loopback, link-local and metadata addresses", () => {
  for (const a of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(isPublicAddress(a), false, a);
  for (const a of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1::1"]) assert.equal(isPublicAddress(a), true, a);
});

test("fetchCapped: a host that resolves to a private address is refused", async () => {
  const lookup = async () => [{ address: "10.0.0.5" }];
  await assert.rejects(fetchCapped("https://evil.example.com/a.png", { fetch: async () => res(PNG), lookup }), Refused);
});

test("fetchCapped: redirects are followed by hand, only to https, three at most", async () => {
  const hop = (to) => async () => new Response(null, { status: 302, headers: { location: to } });
  await assert.rejects(fetchCapped("https://a.example.com/x", { fetch: hop("http://b.example.com/x"), lookup: publicLookup }), Refused);
  await assert.rejects(fetchCapped("https://a.example.com/x", { fetch: hop("https://a.example.com/x"), lookup: publicLookup }), Refused); // a loop
  let n = 0;
  const fetch = async () => (n++ === 0 ? new Response(null, { status: 301, headers: { location: "https://b.example.com/y.png" } }) : res(PNG));
  assert.deepEqual([...(await fetchCapped("https://a.example.com/x", { fetch, lookup: publicLookup }))], [...PNG]);
});

test("fetchCapped: a body past the cap is cut off, a 404 is null, another status is an outage", async () => {
  const big = new Uint8Array(2000);
  await assert.rejects(fetchCapped("https://a.example.com/x", { fetch: async () => res(big), lookup: publicLookup, maxBytes: 1000 }), Refused);
  await assert.rejects(fetchCapped("https://a.example.com/x", { fetch: async () => res(big, { headers: { "content-length": "2000" } }), lookup: publicLookup, maxBytes: 1000 }), Refused);
  assert.equal(await fetchCapped("https://a.example.com/x", { fetch: async () => res("", { status: 404 }), lookup: publicLookup }), null);
  await assert.rejects(fetchCapped("https://a.example.com/x", { fetch: async () => res("", { status: 500 }), lookup: publicLookup }), (e) => !(e instanceof Refused));
});

test("the request names the project contact, never a person", async () => {
  let headers;
  await fetchCapped("https://a.example.com/x", { fetch: async (_u, init) => { headers = init.headers; return res(PNG); }, lookup: publicLookup });
  assert.equal(headers["user-agent"], "Rome Protocol rome@romeprotocol.com");
});

// ---- the small pieces ----

test("rate limiter: a client past the limit is refused until the window ends", () => {
  let t = 0;
  const allow = createRateLimiter({ max: 2, windowMs: 1000, now: () => t });
  assert.deepEqual([allow("a"), allow("a"), allow("a"), allow("b")], [true, true, false, true]);
  t = 1001;
  assert.equal(allow("a"), true);
  assert.equal(clientKey("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(clientKey("2001:db8:1:2:3:4:5:6"), clientKey("2001:db8:1:2:9:9:9:9"));
});

test("stale cache: fresh copy, shared load, and the last good copy when the source fails", async () => {
  let t = 0, loads = 0, fail = false;
  const cache = createStaleCache({ ttlMs: 100, staleMs: 1000, now: () => t });
  const load = async () => { loads++; if (fail) throw new Error("down"); return `v${loads}`; };
  assert.equal(await cache.get("k", load), "v1");
  assert.equal(await cache.get("k", load), "v1");
  assert.equal(loads, 1);
  t = 200; fail = true;
  assert.equal(await cache.get("k", load), "v1"); // stale copy
  t = 5000;
  await assert.rejects(cache.get("k", load)); // too old
  const slow = createStaleCache({ ttlMs: 10, staleMs: 10 });
  let n = 0;
  await Promise.all([slow.get("x", async () => { n++; return 1; }), slow.get("x", async () => { n++; return 1; })]);
  assert.equal(n, 1);
});

test("registry folder, paths and refs", () => {
  assert.equal(registryDirOf({ chainId: "200010", name: "Hadrian" }), "200010-hadrian");
  assert.equal(registryDirOf({ chainId: "7531", name: "Rubicon" }), "7531-rubicon");
  assert.equal(registryDirOf({ chainId: "1", name: "X", registryDir: "1-custom" }), "1-custom");
  assert.equal(isRegistryPath("assets/usdc.svg"), true);
  assert.equal(isRegistryPath("../secrets"), false);
  assert.equal(isRegistryPath("assets/../x"), false);
  assert.equal(isAssetRef("usdc"), true);
  assert.equal(isAssetRef("../x"), false);
});

test("registry credentials: none means no registry; a token is never in an error", () => {
  assert.equal(registryAuthFromEnv({}), null);
  assert.equal(typeof registryAuthFromEnv({ REGISTRY_AUTH_TOKEN: "x" }).token, "function");
  assert.throws(() => registryAuthFromEnv({ REGISTRY_GITHUB_APP_ID: "1" }), /PRIVATE_KEY is required/);
  assert.throws(() => registryAuthFromEnv({ REGISTRY_GITHUB_APP_ID: "1", REGISTRY_GITHUB_APP_PRIVATE_KEY: "SECRETSECRET" }), (e) => !String(e.message).includes("SECRETSECRET"));
  assert.equal(patAuth("t").renewable, false);
});

test("sniffImage reads a long run of comments in linear time", () => {
  const t0 = Date.now();
  assert.equal(sniffImage(new TextEncoder().encode("<!---->".repeat(290) + "x")), null);
  assert.equal(sniffImage(new TextEncoder().encode("<!---->".repeat(290))), null);
  assert.ok(Date.now() - t0 < 200);
});
