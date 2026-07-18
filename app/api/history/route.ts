// /api/history — per-user Aave activity feed for /history.
//
// Query params:
//   chainId — defaults to 200010 (Hadrian)
//   user    — 0x-prefixed EVM address (required)
//   limit   — optional row cap; defaults to 50

import { NextResponse } from "next/server";
import { loadUserHistory } from "@/lib/history-indexer";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chainIdParam = searchParams.get("chainId");
  const chainId = chainIdParam !== null ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return NextResponse.json({ error: `invalid chainId: ${chainIdParam}` }, { status: 400 });
  }
  const user = searchParams.get("user");
  const limitRaw = searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : 50;
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
    return NextResponse.json({ error: "missing or malformed `user` (expected 0x-address)" }, { status: 400 });
  }

  try {
    const data = await loadUserHistory(chainId, user as `0x${string}`, { limit });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
