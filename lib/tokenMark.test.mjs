import { test } from "vitest";
import assert from "node:assert/strict";
import { markLetter, markColor, markFit, MARK_COLORS } from "./tokenMark.mjs";

test("a square image fills the circle; any other shape is drawn whole (never cropped)", () => {
  assert.equal(markFit(512, 512), "fill");
  assert.equal(markFit(512, 490), "fill"); // within 5%
  assert.equal(markFit(100, 95), "fill"); // exactly 5%
  assert.equal(markFit(101, 88), "whole"); // the bare Solana mark
  assert.equal(markFit(88, 101), "whole");
  assert.equal(markFit(300, 150), "whole");
  assert.equal(markFit(0, 0), "fill"); // no size to judge
});

test("the letter is the symbol's first letter, upper case; a symbol with none gets a question mark", () => {
  assert.equal(markLetter("USDC"), "U");
  assert.equal(markLetter("mSOL"), "M");
  assert.equal(markLetter("  tRDA"), "T");
  assert.equal(markLetter("K9He…i633"), "K");
  assert.equal(markLetter("…"), "?");
  assert.equal(markLetter(""), "?");
  assert.equal(markLetter(undefined), "?");
});

test("the colour is stable per symbol, ignores case, and stays inside the palette", () => {
  assert.equal(markColor("USDC"), markColor("usdc"));
  assert.equal(markColor("USDC"), markColor("USDC"));
  for (const s of ["USDC", "SOL", "mSOL", "tRDA", "tRDB", "", "K9He…i633"]) {
    const c = markColor(s);
    assert.ok(Number.isInteger(c) && c >= 0 && c < MARK_COLORS, s);
  }
  // the palette is used: a spread of symbols does not all land on one colour
  const used = new Set(["USDC", "SOL", "mSOL", "tRDA", "tRDB", "WETH", "BONK", "JUP", "JitoSOL"].map(markColor));
  assert.ok(used.size >= 3);
});
