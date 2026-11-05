// A fixed window per key, in memory: allow(key) is false once the key has used `max` calls in the current window.
// Expired keys are swept once per window and the map never holds more than `maxKeys` (a window that fills it starts over).
// No Next.js imports.

export const MAX_KEYS = 10_000;

/** The key a client counts under: an IPv4 address as is, an IPv6 address by its /64 (one client can use a whole /64). */
export function clientKey(ip) {
  const addr = (String(ip ?? "").split("%")[0] ?? "").toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (mapped) return mapped[1];
  if (!addr.includes(":")) return addr || "unknown";
  const side = (part) => part === "" ? [] : part.split(":").flatMap((g) => {
    const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(g);
    return v4 ? [((Number(v4[1]) << 8) | Number(v4[2])).toString(16), ((Number(v4[3]) << 8) | Number(v4[4])).toString(16)] : [g];
  });
  const [head = "", tail] = addr.split("::");
  const h = side(head);
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - side(tail).length)).fill("0"), ...side(tail)];
  return `${groups.slice(0, 4).map((g) => g.padStart(4, "0")).join(":")}::/64`;
}

/** @param {{ max: number, windowMs: number, now?: () => number, maxKeys?: number }} opts */
export function createRateLimiter(opts) {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? MAX_KEYS;
  let windows = new Map();
  let nextSweepAt = 0;
  const allow = (key) => {
    const t = now();
    if (t >= nextSweepAt) {
      for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
      nextSweepAt = t + opts.windowMs;
    }
    let w = windows.get(key);
    if (!w || w.resetAt <= t) {
      if (!w && windows.size >= maxKeys) windows = new Map();
      windows.set(key, (w = { count: 0, resetAt: t + opts.windowMs }));
    }
    w.count += 1;
    return w.count <= opts.max;
  };
  return Object.assign(allow, { size: () => windows.size });
}
