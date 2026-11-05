// Error responses for /api routes: a short message and a code, never the RPC
// URL, request params or library versions. The detail goes to the server log.

import { NextResponse } from "next/server";

export function apiError(route: string, err: unknown): NextResponse {
  console.error(`[${route}]`, err instanceof Error ? err.message : String(err));
  const text = err instanceof Error ? err.message.toLowerCase() : "";
  if (text.includes("too many") || text.includes("rate limit") || text.includes("429")) {
    return NextResponse.json({ error: "The data source is busy. Try again shortly.", code: "upstream_busy" }, { status: 503 });
  }
  return NextResponse.json({ error: "Could not load data. Try again shortly.", code: "upstream_error" }, { status: 502 });
}
