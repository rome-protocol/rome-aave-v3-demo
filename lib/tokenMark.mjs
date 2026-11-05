// The letter mark a token gets when it has no logo (or the logo has not loaded): its first letter on one of the app's own palette colours,
// the colour chosen from the symbol so a token always looks the same. Pure, so node --test pins it.

/** How many palette colours there are (globals.css .tmark.c0 ... .tmark.c5). */
export const MARK_COLORS = 6;

/** The letter drawn for a symbol: its first letter or digit, upper case; "?" when it has none. */
export function markLetter(symbol) {
  const m = /[\p{L}\p{N}]/u.exec(String(symbol ?? "").trim());
  return m ? m[0].toUpperCase() : "?";
}

/** Which palette colour a symbol gets: a stable hash of the whole symbol, so "tRDA" and "tRDB" are not tied to the same first letter. */
export function markColor(symbol) {
  let h = 2166136261;
  for (const ch of String(symbol ?? "").trim().toLowerCase()) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h % MARK_COLORS;
}

/**
 * How a logo is drawn in the round mark, decided by the loaded image's own shape and never by cropping it:
 *   "fill"  a square image (width and height within 5% of each other) is a token icon, made to fill the circle (how Orca shows them);
 *   "whole" any other shape (the bare Solana mark is 101x88) is drawn whole: contained, centred, with even padding, so no part is cut.
 * An image that reports no size (some SVGs) has no shape to judge and is treated as a square icon.
 */
export const SQUARE_TOLERANCE = 0.05;
export function markFit(width, height) {
  const w = Number(width), h = Number(height);
  if (!(w > 0) || !(h > 0)) return "fill";
  return Math.abs(w - h) / Math.max(w, h) <= SQUARE_TOLERANCE ? "fill" : "whole";
}
