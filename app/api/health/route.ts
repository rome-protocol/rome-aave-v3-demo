// /api/health — process liveness probe. Returns {ok:true} as soon as
// Next can serve a request. Meant for health checks and smoke checks.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "rome-aave-v3-demo",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
