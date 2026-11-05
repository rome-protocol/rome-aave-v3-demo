// GET /api/token?mint=<mint> -> { mint, symbol, name, source, logo }: who one token is. Order: the registry by mint, then Jupiter's verified
// list, then the mint's own on-chain metadata; `logo` says whether /api/token/logo has an image. 404 when it is not a token, 503 when nothing answered.
import { NextResponse } from "next/server";
import { failureStatus, requestClient, tokenApi } from "@/lib/server/tokenApi.mjs";
import { tokenChain } from "@/lib/server/tokenChain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const api = tokenApi();
  if (!api.identityLimit(requestClient(req))) return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: { "cache-control": "no-store" } });
  try {
    const id = await api.service.identity(tokenChain(), new URL(req.url).searchParams.get("mint") ?? "");
    return NextResponse.json(id, { headers: { "cache-control": "public, max-age=60" } });
  } catch (e) {
    const status = failureStatus(e);
    return NextResponse.json({ error: status === 404 ? "Not a token" : "Could not read the token" }, { status, headers: { "cache-control": "no-store" } });
  }
}
