// Flash-loan composer amounts. A default of "1000" rounds to 0 for an asset with less than one unit available
// (Math.floor), which leaves Execute disabled with no hint why. These keep a usable number instead.

/** Largest amount (as a decimal string, cut not rounded) that fits `decimals` and stays at or below `available`. */
export function maxFlashAmount(available: number, decimals: number): string {
  if (!Number.isFinite(available) || available <= 0) return "0";
  const dp = Math.max(0, Math.min(decimals, 6));
  const f = 10 ** dp;
  const cut = Math.floor(available * f + 1e-9) / f;
  if (cut <= 0) return "0";
  const s = cut.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * The amount the composer starts with after an asset is picked: 1,000 when that much is available, otherwise
 * what is available up to one whole unit, and half of it when less than one unit is.
 */
export function defaultFlashAmount(available: number, decimals: number): string {
  if (!Number.isFinite(available) || available <= 0) return "0";
  if (available >= 1000) return "1000";
  if (available >= 1) return String(Math.floor(available));
  return maxFlashAmount(available / 2, decimals);
}
