// In-process TTL memo for slow server-side reads. Each demo VM runs a
// single Next.js process so a Map is plenty — no cross-process eviction
// needed. Promise-sharing dedupes concurrent misses so 10 page loads
// during a cold cache window do ONE upstream call, not 10.
//
// Stale-while-revalidate: pass `staleTtlMs` to keep serving the last
// resolved value past expiry while a background refresh runs. Eliminates
// the recurring 5.5s mid-session stall that fired every 30s when the
// previous fresh-only path coincided with the client's refetchInterval.

interface Entry<T> {
  expiresAt: number;
  promise: Promise<T>;
  lastValue?: T;
  refreshing: boolean;
  /** Consecutive failed background refreshes since the last success. After
   *  REFRESH_FAIL_THRESHOLD, the entry is evicted so the next caller hits a
   *  cold load that surfaces the upstream error — otherwise a persistent
   *  outage would serve arbitrarily-stale data indefinitely. */
  consecutiveRefreshFails: number;
}

const STORE = new Map<string, Entry<unknown>>();
const REFRESH_FAIL_THRESHOLD = 3;

interface Options {
  /** How long to keep serving the last value past `ttlMs` while a background refresh is in flight. 0 = no SWR. */
  staleTtlMs?: number;
}

export function memoTtl<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  options?: Options,
): Promise<T> {
  const now = Date.now();
  const hit = STORE.get(key) as Entry<T> | undefined;

  // Fresh: return as-is.
  if (hit && hit.expiresAt > now) return hit.promise;

  // Stale-but-serviceable: serve last value immediately, kick off
  // background refresh if not already running.
  const staleTtlMs = options?.staleTtlMs ?? 0;
  if (hit && hit.lastValue !== undefined && staleTtlMs > 0 && hit.expiresAt + staleTtlMs > now) {
    if (!hit.refreshing) {
      hit.refreshing = true;
      loader()
        .then((v) => {
          const e = STORE.get(key) as Entry<T> | undefined;
          if (!e) return;
          e.expiresAt = Date.now() + ttlMs;
          e.lastValue = v;
          e.promise = Promise.resolve(v);
          e.refreshing = false;
          e.consecutiveRefreshFails = 0;
        })
        .catch((err) => {
          // Background refresh failed — keep serving stale value, clear the
          // refreshing flag so the next stale hit can retry. After
          // REFRESH_FAIL_THRESHOLD consecutive failures evict the entry so a
          // cold load surfaces the upstream error to the caller instead of
          // serving arbitrarily-stale data forever.
          const e = STORE.get(key);
          if (e) {
            e.refreshing = false;
            e.consecutiveRefreshFails += 1;
            if (e.consecutiveRefreshFails >= REFRESH_FAIL_THRESHOLD) {
              STORE.delete(key);
              console.error(
                `[memoTtl] ${REFRESH_FAIL_THRESHOLD} consecutive refresh failures for ${key} — evicting stale entry. Cause:`,
                err,
              );
              return;
            }
          }
          console.error(`[memoTtl] background refresh failed for ${key}:`, err);
        });
    }
    return Promise.resolve(hit.lastValue);
  }

  // No usable data (cold, or stale past staleTtl) — full upstream call.
  const promise = loader().catch((err) => {
    if (STORE.get(key)?.promise === promise) STORE.delete(key);
    throw err;
  });
  const entry: Entry<T> = { expiresAt: now + ttlMs, promise, refreshing: false, consecutiveRefreshFails: 0 };
  STORE.set(key, entry as Entry<unknown>);
  // Capture lastValue when this initial load resolves successfully so a
  // future stale hit can serve it without waiting.
  promise.then((v) => {
    const e = STORE.get(key) as Entry<T> | undefined;
    if (e && e.promise === promise) e.lastValue = v;
  }).catch(() => {});
  return promise;
}

/** Test-only — clear the in-process cache. Not used in app code. */
export function _memoTtlReset(): void {
  STORE.clear();
}
