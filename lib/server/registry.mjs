// Reads the Rome registry: a chain's token list and the assets (symbol, name, logo) the tokens point at.
// Raw files from the host named in registryHost.mjs, with a bearer token (registryAuth.mjs). This build names no host.
// No Next.js imports.
import { USER_AGENT } from "./registryAuth.mjs";
import { REGISTRY_RAW_BASE } from "./registryHost.mjs";

/** The registry folder of a chain: its optional `registryDir` setting, else "<chainId>-<name>" (Hadrian = 200010-hadrian, Rubicon = 7531-rubicon). */
export function registryDirOf(chain) {
  if (chain.registryDir) return String(chain.registryDir);
  const slug = String(chain.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `${chain.chainId}-${slug}` : String(chain.chainId);
}

/** A path inside the registry from its root: segments of letters, digits, dot, underscore and hyphen, none of them dots only. */
export const isRegistryPath = (path) => /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(path) && path.split("/").every((s) => !/^\.+$/.test(s));

/** The key of an asset (assets/<ref>.json, a token's assetRef). */
export const isAssetRef = (ref) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(ref);

export class RegistryHttpError extends Error {
  constructor(file, status) {
    super(`registry answered ${status} for ${file}`);
    this.status = status;
  }
}

/** @param {{ ref?: string, auth: { token(): Promise<string>, renewable: boolean, invalidate(): void }, timeoutMs?: number, fetch?: typeof fetch }} opts */
export function createRegistrySource(opts) {
  const base = "base" in opts ? opts.base : REGISTRY_RAW_BASE;
  // A build with no registry source (a null base) knows nothing: every read answers "not there" and the token service goes on to its next source.
  if (!base) return { tokens: async () => null, asset: async () => null, file: async () => null };
  const doFetch = opts.fetch ?? fetch;
  const ref = opts.ref || "main";
  async function fetchFile(path, renew = true) {
    // raw.githubusercontent.com answers 404 (never 401) to a bad or ended token. An App token the registry refuses is renewed once and the read tried
    // again; a personal token cannot be renewed, so its 404 is final. Only the token list proves the token; an asset or a logo the registry lacks is an ordinary 404.
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${base}/${ref}/${path}`, {
        headers: { accept: "application/json", "user-agent": USER_AGENT, authorization: `Bearer ${await opts.auth.token()}` },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 3000),
      });
      if ((res.status === 404 || res.status === 401) && attempt === 0 && renew && opts.auth.renewable) {
        opts.auth.invalidate();
        continue;
      }
      return res;
    }
  }
  async function json(path, renew) {
    const res = await fetchFile(path, renew);
    if (res.status === 404) return null;
    if (!res.ok) throw new RegistryHttpError(path, res.status);
    return res.json();
  }
  return {
    /** chains/<dir>/tokens.json as a list; null when the chain has no folder. */
    async tokens(dir) {
      if (!isRegistryPath(`chains/${dir}`)) return null;
      const body = await json(`chains/${dir}/tokens.json`, true);
      if (body === null) return null;
      if (!Array.isArray(body)) throw new Error("registry tokens.json is not a list");
      return body;
    },
    /** assets/<ref>.json, or null when the registry has none. */
    async asset(assetRef) {
      if (!isAssetRef(assetRef)) return null;
      const body = await json(`assets/${assetRef}.json`, false);
      if (body === null) return null;
      if (typeof body !== "object" || Array.isArray(body)) throw new Error(`registry asset ${assetRef} is not an object`);
      return body;
    },
    /** A file of the registry by its path from the root (a logo kept there), as bytes; null when it is not there. */
    async file(path) {
      if (!isRegistryPath(path)) return null;
      const res = await fetchFile(path, false);
      if (res.status === 404) return null;
      if (!res.ok) throw new RegistryHttpError(path, res.status);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
