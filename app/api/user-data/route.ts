// /api/user-data — per-user position snapshot for a given chain.
//
// Query params:
//   chainId — defaults to 200010 (Hadrian)
//   user    — 0x-prefixed EVM address (required)
//
// Cache: 5s in-process per (chain, user). Without it every page render
// (Markets / Dashboard / AssetDetail / History) refetches independently
// and each pays ~2s of RPC latency. Concurrent misses share one
// upstream call via memoTtl's promise reuse.

import { NextResponse } from "next/server";
import { loadFullUserData } from "@/lib/aave-reader";
import { memoTtl } from "@/lib/memo";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chainIdParam = searchParams.get("chainId");
  const chainId = chainIdParam !== null ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return NextResponse.json({ error: `invalid chainId: ${chainIdParam}` }, { status: 400 });
  }
  const user = searchParams.get("user");
  if (!user || !/^0x[a-fA-F0-9]{40}$/.test(user)) {
    return NextResponse.json({ error: "missing or malformed `user` (expected 0x-address)" }, { status: 400 });
  }
  try {
    const lower = user.toLowerCase() as `0x${string}`;
    const data = await memoTtl(`user-data:${chainId}:${lower}`, 5_000, () =>
      loadFullUserData(chainId, lower),
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=5, s-maxage=5" },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
