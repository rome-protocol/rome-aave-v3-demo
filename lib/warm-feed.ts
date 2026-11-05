// A value kept warm in memory: rebuilt in the background every `intervalMs` (started on first use, one
// rebuild in flight at a time). A read answers from memory at once; only the very first read waits.

export interface WarmFeed<T> {
  get(): Promise<{ value: T; generatedAt: number }>;
  /**
   * Patch the held value (e.g. one re-read borrower) without a rebuild; no-op before the first build.
   * A rebuild already in flight may have read before the change, so the patch is re-applied to its result;
   * `fn` must therefore be safe to run on a newer value.
   */
  update(fn: (value: T) => T): void;
}

export function createWarmFeed<T>(build: () => Promise<T>, intervalMs: number): WarmFeed<T> {
  let held: { value: T; generatedAt: number } | null = null;
  let inFlight: Promise<void> | null = null;
  let patches: Array<(value: T) => T> = []; // patches made while the current build runs
  let started = false;

  const rebuild = (): Promise<void> => {
    if (!inFlight) {
      patches = [];
      inFlight = build()
        .then((value) => void (held = { value: patches.reduce((v, fn) => fn(v), value), generatedAt: Date.now() }))
        .finally(() => void (inFlight = null));
    }
    return inFlight;
  };

  return {
    async get() {
      if (!held) await rebuild(); // a failed first build throws and leaves no timer behind
      if (!started) {
        started = true;
        const timer = setInterval(() => void rebuild().catch((e) => console.warn("[at-risk] refresh failed, keeping the last list:", e instanceof Error ? e.message : e)), intervalMs);
        (timer as { unref?: () => void }).unref?.();
      }
      return held as { value: T; generatedAt: number };
    },
    update(fn) {
      if (!held) return;
      held = { ...held, value: fn(held.value) };
      if (inFlight) patches.push(fn);
    },
  };
}
