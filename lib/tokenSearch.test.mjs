import { test } from "vitest";
import assert from "node:assert/strict";
import { filterTokens, looksLikeAddress, looksPasted } from "./tokenSearch.mjs";

const T = [
  { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin" },
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL" },
  { mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", symbol: "mSOL", name: "Marinade staked SOL" },
];

test("an empty box lists every token in order", () => {
  assert.deepEqual(filterTokens(T, "  "), T);
});
test("a word matches the symbol or the name, in any case", () => {
  assert.deepEqual(filterTokens(T, "usd").map((t) => t.symbol), ["USDC"]);
  assert.deepEqual(filterTokens(T, "SOL").map((t) => t.symbol), ["SOL", "mSOL"]);
  assert.deepEqual(filterTokens(T, "marinade").map((t) => t.symbol), ["mSOL"]);
});
test("a whole address or its first characters find the token", () => {
  assert.deepEqual(filterTokens(T, T[1].mint).map((t) => t.symbol), ["SOL"]);
  assert.deepEqual(filterTokens(T, "EPjF").map((t) => t.symbol), ["USDC"]);
});
test("nothing matching gives an empty list", () => {
  assert.deepEqual(filterTokens(T, "zzz"), []);
});
test("an address is told apart from a word", () => {
  assert.equal(looksLikeAddress(T[0].mint), true);
  assert.equal(looksLikeAddress(` ${T[0].mint} `), true);
  assert.equal(looksLikeAddress("USDC"), false);
  assert.equal(looksLikeAddress("0OIl" + "1".repeat(30)), false);
});

test("a long text with no spaces is taken as a pasted address (the read says whether it is real); words and short texts are not", () => {
  assert.equal(looksPasted(T[0].mint), true);
  assert.equal(looksPasted("notanaddressatallbutlongenoughtobetried1234567890"), true);
  assert.equal(looksPasted("not an address at all, but long enough to be tried 1234567890"), false);
  assert.equal(looksPasted("USDC"), false);
});
