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
  /** Set by memoRefresh: when the value was last loaded on request. */
  refreshedAt?: number;
  /** When the loader that produced the held value started. A result from a loader that started earlier never replaces it: the newest wins. */
  startedAt: number;
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
      const startedAt = now;
      loader()
        .then((v) => {
          const e = STORE.get(key) as Entry<T> | undefined;
          if (!e) return;
          e.refreshing = false;
          e.consecutiveRefreshFails = 0;
          // A post-action refresh that started after this one may have landed first: keep its newer value.
          if (e.startedAt > startedAt) return;
          e.expiresAt = Date.now() + ttlMs;
          e.lastValue = v;
          e.promise = Promise.resolve(v);
          e.startedAt = startedAt;
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
  const entry: Entry<T> = { expiresAt: now + ttlMs, promise, refreshing: false, consecutiveRefreshFails: 0, startedAt: now };
  STORE.set(key, entry as Entry<unknown>);
  // Capture lastValue when this initial load resolves successfully so a
  // future stale hit can serve it without waiting.
  promise.then((v) => {
    const e = STORE.get(key) as Entry<T> | undefined;
    if (e && e.promise === promise) e.lastValue = v;
  }).catch(() => {});
  return promise;
}

const REFRESHES = new Map<string, Promise<unknown>>();
/** A value loaded by memoRefresh this recently is reused, so repeated fresh requests cannot hammer the RPC. */
const REFRESH_REUSE_MS = 1_500;

/**
 * Load a new value now (post-action reads) without evicting the cached one:
 * normal callers keep getting the last value until the new one lands. One
 * loader runs per key at a time; on failure the entry is left as it was.
 */
export function memoRefresh<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = STORE.get(key) as Entry<T> | undefined;
  if (hit?.refreshedAt && hit.lastValue !== undefined && Date.now() - hit.refreshedAt < REFRESH_REUSE_MS) {
    return Promise.resolve(hit.lastValue);
  }
  const running = REFRESHES.get(key) as Promise<T> | undefined;
  if (running) return running;
  const startedAt = Date.now();
  const p = loader()
    .then((v) => {
      const now = Date.now();
      // A background refresh that started after this one and finished first holds the newer value: keep it.
      const held = STORE.get(key) as Entry<T> | undefined;
      if (held && held.lastValue !== undefined && held.startedAt > startedAt) return v;
      STORE.set(key, {
        expiresAt: now + ttlMs,
        promise: Promise.resolve(v),
        lastValue: v,
        refreshing: false,
        consecutiveRefreshFails: 0,
        refreshedAt: now,
        startedAt,
      } as Entry<unknown>);
      return v;
    })
    .finally(() => REFRESHES.delete(key));
  REFRESHES.set(key, p);
  return p;
}

/** Test-only — clear the in-process cache. Not used in app code. */
export function _memoTtlReset(): void {
  STORE.clear();
  REFRESHES.clear();
}
