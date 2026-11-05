// How old the liquidation list is. The server says so in seconds (ageSeconds, measured on its own clock when it answered); the page adds only the time
// that has passed since the answer arrived, which its own clock can measure. The server rebuilds it every 15 s;
// when it is older than three rebuilds the list is behind (a rebuild keeps failing) and the page says so.

export const FEED_LATE_MS = 45_000;

export function feedAgeMs(ageSeconds: number | undefined, receivedAt: number, now: number): number | null {
  if (typeof ageSeconds !== "number" || !Number.isFinite(ageSeconds) || !receivedAt) return null;
  return Math.max(0, ageSeconds * 1000 + Math.max(0, now - receivedAt));
}

export function feedAgeLabel(ageMs: number): string {
  const s = Math.floor(ageMs / 1000);
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}
