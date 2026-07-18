// /api/aave-config — returns the demo's per-chain config + live reserve data.
//
// Query params:
//   chainId — defaults to 200010 (Hadrian)
//
// Cache: 30s fresh + 5min stale-while-revalidate. buildDemoConfig does ~20
// RPC calls against Hadrian; cold cache observed at ~5.5s. Without SWR the
// client's 30s refetchInterval phase-locked with the 30s TTL so every cycle
// paid the full cold cost. SWR returns the last value instantly past expiry
// and kicks off the refresh in the background — the user never waits.
// Concurrent misses share one upstream call via memoTtl's promise reuse.

import { NextResponse } from "next/server";
import { buildDemoConfig } from "@/lib/aave-reader";
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

  try {
    const config = await memoTtl(
      `aave-config:${chainId}`,
      30_000,
      () => buildDemoConfig(chainId),
      { staleTtlMs: 5 * 60_000 },
    );
    return NextResponse.json(config, {
      headers: { "Cache-Control": "public, max-age=10, s-maxage=10" },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? String(err) },
      { status: 500 },
    );
  }
}
