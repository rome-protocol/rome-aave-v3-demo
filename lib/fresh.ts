// Post-action refresh: for a short window after the user's own transaction
// confirms, the page's reads carry `&fresh=1` so the API routes skip their
// cached answer and the user sees the new balances. Normal loads keep the caches.

export const FRESH_WINDOW_MS = 20_000;

let freshUntil = 0;

/** Call right after a confirmed action, before invalidating queries. */
export function markFresh(now: number = Date.now()): void {
  freshUntil = now + FRESH_WINDOW_MS;
}

/** Query-string suffix for client fetches. */
export function freshParam(now: number = Date.now()): string {
  return now < freshUntil ? "&fresh=1" : "";
}

/** Server side: did the client ask to bypass the caches? */
export function wantsFresh(params: URLSearchParams): boolean {
  return params.get("fresh") === "1";
}

/** Cache-Control for a route response. */
export function cacheControlFor(fresh: boolean, normal: string): string {
  return fresh ? "no-store" : normal;
}
