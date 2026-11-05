// The app's one token service and the rules the two token routes share (/api/token, /api/token/logo).
// This build names no registry host (registryHost.mjs), so the
// service reads Jupiter's verified list, then each token's own on-chain metadata. Nothing here logs a token or an upstream address.
import { createRateLimiter, clientKey } from "./rateLimit.mjs";
import { createRegistrySource } from "./registry.mjs";
import { registryAuthFromEnv } from "./registryAuth.mjs";
import { createTokenService, LOGO_LIMIT } from "./tokenService.mjs";

/** The identity read costs an on-chain read for a mint nobody asked about before; a page asks once per mint. */
export const IDENTITY_LIMIT = { max: 120, windowMs: 60_000 };

const KEY = Symbol.for("aave-demo.token-service");

function build() {
  let registry = null;
  try {
    const auth = registryAuthFromEnv(process.env);
    if (auth) registry = createRegistrySource({ ref: process.env.REGISTRY_REF, auth });
  } catch (e) {
    // A misconfigured App key must not take the page down: the marks fall back to Jupiter and on-chain metadata. The reason names the setting, never the key.
    console.warn(`token registry disabled: ${e instanceof Error ? e.message : "bad registry credentials"}`);
  }
  return {
    service: createTokenService({ registry, log: (event, fields) => console.warn(`token service: ${event}`, fields ?? {}) }),
    logoLimit: createRateLimiter(LOGO_LIMIT),
    identityLimit: createRateLimiter(IDENTITY_LIMIT),
  };
}

export const tokenApi = () => (globalThis[KEY] ??= build());

/** The client a request counts under: the last address in X-Forwarded-For, else "unknown". */
export function requestClient(req) {
  const xff = req.headers.get("x-forwarded-for");
  const last = xff ? xff.split(",").pop()?.trim() : "";
  return clientKey(last || "unknown");
}

/** The status a failure maps to: 404 not a token, 503 nobody answered, 500 anything else. */
export const failureStatus = (e) => (e?.code === "not-a-token" ? 404 : e?.code === "unavailable" ? 503 : 500);
