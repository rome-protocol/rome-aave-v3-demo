// /api/at-risk — borrower positions trending toward liquidation.
//
// Query params:
//   chainId — defaults to 200010 (Hadrian)
//   hfMax   — defaults to 1.05; rows with HF > hfMax are excluded
//
// Returns the array shape used by data.jsx's AT_RISK global. Driven by
// at-risk-indexer.ts which scans Pool.Borrow events + polls
// Pool.getUserAccountData on each known borrower.

import { NextResponse } from "next/server";
import { loadAtRiskFeed } from "@/lib/at-risk-indexer";
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
  const hfMaxParam = searchParams.get("hfMax");
  const hfMax = hfMaxParam !== null ? Number(hfMaxParam) : 1.05;
  if (!Number.isFinite(hfMax) || hfMax <= 0) {
    return NextResponse.json({ error: `invalid hfMax: ${hfMaxParam}` }, { status: 400 });
  }

  try {
    const data = await loadAtRiskFeed(chainId, { hfMax });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
