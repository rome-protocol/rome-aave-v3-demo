// A small in-memory cache with a short fresh time and a longer stale copy, plus one shared load per key.
//   get(key, load): a copy younger than ttlMs is returned as is; otherwise load() runs (callers that arrive meanwhile share it).
//   When load() fails, the last good copy (up to staleMs old) is returned instead; with no copy the error goes on.
// The map holds at most maxEntries keys (the oldest go first). No Next.js imports.

/** @template T @param {{ ttlMs: number, staleMs: number, maxEntries?: number, now?: () => number }} opts */
export function createStaleCache(opts) {
  const now = opts.now ?? Date.now;
  const maxEntries = opts.maxEntries ?? 1000;
  /** @type {Map<string, { value: T, at: number }>} */
  const copies = new Map();
  /** @type {Map<string, Promise<T>>} */
  const loading = new Map();

  function keep(key, value) {
    copies.delete(key); // re-insert last: Map order is oldest first
    copies.set(key, { value, at: now() });
    while (copies.size > maxEntries) copies.delete(copies.keys().next().value);
  }

  return {
    /** @param {string} key @param {() => Promise<T>} load @returns {Promise<T>} */
    async get(key, load) {
      const copy = copies.get(key);
      if (copy && now() - copy.at < opts.ttlMs) return copy.value;
      let running = loading.get(key);
      if (!running) {
        running = (async () => load())();
        loading.set(key, running);
        const free = () => { if (loading.get(key) === running) loading.delete(key); };
        running.then(free, free);
      }
      try {
        const value = await running;
        keep(key, value);
        return value;
      } catch (e) {
        if (copy && now() - copy.at < opts.staleMs) return copy.value;
        throw e;
      }
    },
    size: () => copies.size,
  };
}
