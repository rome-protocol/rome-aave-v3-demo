// /api/market-overview — market totals split by EVM / Solana side, served from memory.
// 202 {status:"building"} until the first background build finishes or while its balances are stale; otherwise instant.

import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { getMarketOverview, isSupportedChain } from "@/lib/market-overview";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const chainIdParam = searchParams.get("chainId");
  const chainId = chainIdParam !== null ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  if (!Number.isFinite(chainId) || chainId <= 0) {
    return NextResponse.json({ error: `invalid chainId: ${chainIdParam}` }, { status: 400 });
  }
  if (!isSupportedChain(chainId)) return NextResponse.json({ error: `unsupported chainId: ${chainId}` }, { status: 404 });
  try {
    const data = getMarketOverview(chainId);
    if (!data) return NextResponse.json({ status: "building" }, { status: 202, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err: unknown) {
    return apiError("/api/market-overview", err);
  }
}
