// How the app proves itself to the Rome registry (rome-protocol/registry): a GitHub App
// installation token (REGISTRY_GITHUB_APP_ID + REGISTRY_GITHUB_APP_PRIVATE_KEY) or, for a local run, a personal access token
// (REGISTRY_AUTH_TOKEN). The App wins when both are set. A token is never logged, never put in an error, never stored in a file.
// No Next.js imports.
import { createPrivateKey, createSign } from "node:crypto";

export const USER_AGENT = "Rome Protocol rome@romeprotocol.com";
const GITHUB_API = "https://api.github.com";
export const GITHUB_ORG = "rome-protocol";
const RENEW_BEFORE_MS = 5 * 60_000;
const MINT_TIMEOUT_MS = 10_000;

/** GitHub refused the credentials (wrong App id, a key that does not match, an App not installed on the organisation): a deploy mistake. */
export class RegistryAuthError extends Error {}

function readPrivateKey(raw) {
  const refuse = () => new Error("REGISTRY_GITHUB_APP_PRIVATE_KEY is not an RSA private key (give the PEM, or the PEM base64 encoded)");
  let pem = raw.trim();
  if (!pem.startsWith("-----BEGIN")) {
    try { pem = Buffer.from(pem, "base64").toString("utf8"); } catch { throw refuse(); }
  }
  try {
    const key = createPrivateKey(pem.replace(/\\n/g, "\n"));
    if (key.asymmetricKeyType !== "rsa") throw refuse();
    return key;
  } catch {
    // Node's message for a bad key is not repeated: it is not worth the chance of echoing key material.
    throw refuse();
  }
}

const b64url = (b) => Buffer.from(b).toString("base64url");

function appJwt(appId, key, nowMs) {
  const now = Math.floor(nowMs / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }))}`;
  return `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(key))}`;
}

/** A personal access token. */
export function patAuth(token) {
  return { token: async () => token, renewable: false, invalidate: () => {} };
}

/** A GitHub App installation token, minted from the App's id and private key and renewed before it expires. */
export function appAuth(appId, privateKeyRaw, opts = {}) {
  const key = readPrivateKey(privateKeyRaw);
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let installationId;
  let current;
  let minting;

  async function call(method, path, step, jwt) {
    let res;
    try {
      res = await doFetch(`${GITHUB_API}${path}`, {
        method,
        headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(`registry token: ${step} did not answer (${e instanceof Error ? e.name : "error"})`);
    }
    const rateLimited = res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.get("retry-after") !== null);
    if (rateLimited) throw new Error(`registry token: ${step} answered HTTP 403 (rate limited)`);
    // Only the status goes into a message: a body is never copied.
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      throw new RegistryAuthError(`registry token: GitHub refused the App credentials at ${step} (HTTP ${res.status}); check REGISTRY_GITHUB_APP_ID, the private key, and that the App is installed on ${GITHUB_ORG}`);
    }
    if (res.status !== 200 && res.status !== 201) throw new Error(`registry token: ${step} answered HTTP ${res.status}`);
    const body = await res.json();
    if (typeof body !== "object" || body === null) throw new Error(`registry token: ${step} answered something that is not JSON`);
    return body;
  }

  async function mint() {
    const jwt = appJwt(appId, key, now());
    if (installationId === undefined) {
      const inst = await call("GET", `/orgs/${GITHUB_ORG}/installation`, "the installation lookup", jwt);
      if (typeof inst.id !== "number") throw new Error("registry token: the installation lookup carried no id");
      installationId = inst.id;
    }
    let body;
    try {
      body = await call("POST", `/app/installations/${installationId}/access_tokens`, "the token request", jwt);
    } catch (e) {
      installationId = undefined; // the installation may have been replaced: look it up again next time
      throw e;
    }
    const token = body.token;
    if (typeof token !== "string" || token === "") throw new Error("registry token: the token request carried no token");
    const expires = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
    current = { token, expiresAt: Number.isFinite(expires) ? expires : now() + 30 * 60_000 };
    return token;
  }

  return {
    renewable: true,
    async token() {
      if (current && now() < current.expiresAt - RENEW_BEFORE_MS) return current.token;
      minting ??= mint().finally(() => { minting = undefined; });
      return minting;
    },
    invalidate() { current = undefined; },
  };
}

/**
 * The registry credentials the deploy names: the App (id and private key together) or a personal token.
 * With neither this returns null: the app then skips the registry and reads the token's own on-chain metadata (CI, a local run).
 */
export function registryAuthFromEnv(env, opts = {}) {
  const appId = env.REGISTRY_GITHUB_APP_ID?.trim();
  const privateKey = env.REGISTRY_GITHUB_APP_PRIVATE_KEY?.trim();
  if (appId || privateKey) {
    if (!appId) throw new Error("REGISTRY_GITHUB_APP_ID is required when REGISTRY_GITHUB_APP_PRIVATE_KEY is set");
    if (!privateKey) throw new Error("REGISTRY_GITHUB_APP_PRIVATE_KEY is required when REGISTRY_GITHUB_APP_ID is set");
    return appAuth(appId, privateKey, opts);
  }
  const pat = env.REGISTRY_AUTH_TOKEN?.trim();
  return pat ? patAuth(pat) : null;
}
