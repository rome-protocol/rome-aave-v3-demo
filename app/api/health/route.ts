// /api/health — process liveness probe. Returns {ok:true} as soon as
// Next can serve a request. Used by the container HEALTHCHECK and by
// a container health check.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      service: "aave-demo",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
