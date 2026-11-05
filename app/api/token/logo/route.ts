// GET /api/token/logo?mint=<mint> -> the token's logo image, served from this app's own origin so the page never loads an image from a
// third party. The bytes are checked to be an image, size capped, and fetched only from https hosts (lib/server/logoFetch.mjs).
// 404 when the token has no logo: the page then draws a letter.
import { failureStatus, requestClient, tokenApi } from "@/lib/server/tokenApi.mjs";
import { tokenChain } from "@/lib/server/tokenChain";
import { LOGO_BROWSER_TTL_SECONDS } from "@/lib/server/tokenService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const plain = (status: number, extra: Record<string, string> = {}) => new Response(null, { status, headers: { "cache-control": "no-store", ...extra } });

export async function GET(req: Request) {
  const api = tokenApi();
  if (!api.logoLimit(requestClient(req))) return plain(429, { "retry-after": "60" });
  try {
    const logo = await api.service.logo(tokenChain(), new URL(req.url).searchParams.get("mint") ?? "");
    if (!logo) return plain(404);
    return new Response(new Uint8Array(logo.body), {
      headers: {
        "content-type": logo.type,
        "cache-control": `public, max-age=${LOGO_BROWSER_TTL_SECONDS}`,
        "x-content-type-options": "nosniff",
        // An SVG opened on its own address runs nothing: no scripts, no outside loads.
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return plain(failureStatus(e));
  }
}
