// The token picker's favorites and recent list: pure logic, kept in the browser's own storage (one key per Rome chain), never a server.
import { test } from "vitest";
import assert from "node:assert/strict";
import { RECENT_CAP, storageKey, emptyPrefs, loadPrefs, savePrefs, toggleFavorite, pushRecent, clearRecent, pruneUnknown } from "./pickerPrefs.mjs";

const memory = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, _m: m };
};
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };

test("the key is per Rome chain", () => {
  assert.equal(storageKey("200010"), "aave:picker:v1:200010");
  assert.notEqual(storageKey("121212"), storageKey("200010"));
});

test("a fresh browser has no favorites and no recent", () => {
  assert.deepEqual(loadPrefs(memory(), "1"), { favorites: [], recent: [] });
  assert.deepEqual(emptyPrefs(), { favorites: [], recent: [] });
});

test("save then load gives the same lists", () => {
  const s = memory();
  assert.equal(savePrefs(s, "1", { favorites: ["A", "B"], recent: ["C"] }), true);
  assert.deepEqual(loadPrefs(s, "1"), { favorites: ["A", "B"], recent: ["C"] });
  assert.deepEqual(loadPrefs(s, "2"), { favorites: [], recent: [] });
  assert.deepEqual(JSON.parse(s._m.get("aave:picker:v1:1")), { favorites: ["A", "B"], recent: ["C"] });
});

test("toggleFavorite adds at the end, and a second toggle removes it; the input is not changed", () => {
  const p = { favorites: ["A"], recent: ["R"] };
  const q = toggleFavorite(p, "B");
  assert.deepEqual(q, { favorites: ["A", "B"], recent: ["R"] });
  assert.deepEqual(p, { favorites: ["A"], recent: ["R"] });
  assert.deepEqual(toggleFavorite(q, "A"), { favorites: ["B"], recent: ["R"] });
});

test("pushRecent puts the newest first, dedupes, and caps at five", () => {
  assert.equal(RECENT_CAP, 5);
  let p = emptyPrefs();
  for (const m of ["A", "B", "C", "D", "E"]) p = pushRecent(p, m);
  assert.deepEqual(p.recent, ["E", "D", "C", "B", "A"]);
  p = pushRecent(p, "C");
  assert.deepEqual(p.recent, ["C", "E", "D", "B", "A"]);
  p = pushRecent(p, "F");
  assert.deepEqual(p.recent, ["F", "C", "E", "D", "B"]);
  assert.deepEqual(pushRecent(p, "").recent, p.recent, "an empty mint is not recorded");
});

test("clearRecent empties recent and keeps the favorites", () => {
  assert.deepEqual(clearRecent({ favorites: ["A"], recent: ["B", "C"] }), { favorites: ["A"], recent: [] });
});

test("pruneUnknown drops mints the token list does not know, in both lists", () => {
  const p = { favorites: ["A", "X"], recent: ["Y", "B", "A"] };
  assert.deepEqual(pruneUnknown(p, ["A", "B"]), { favorites: ["A"], recent: ["B", "A"] });
  assert.deepEqual(loadPrefs(memory({ [storageKey("1")]: JSON.stringify(p) }), "1", ["A", "B"]), { favorites: ["A"], recent: ["B", "A"] });
  assert.deepEqual(pruneUnknown(p, undefined), p, "no list given: nothing is dropped");
});

test("load survives garbage: bad JSON, wrong shapes, non-strings, duplicates, too many recent", () => {
  assert.deepEqual(loadPrefs(memory({ [storageKey("1")]: "{nope" }), "1"), { favorites: [], recent: [] });
  assert.deepEqual(loadPrefs(memory({ [storageKey("1")]: "null" }), "1"), { favorites: [], recent: [] });
  assert.deepEqual(loadPrefs(memory({ [storageKey("1")]: JSON.stringify({ favorites: "A", recent: 5 }) }), "1"), { favorites: [], recent: [] });
  const raw = JSON.stringify({ favorites: ["A", 3, "A", null, "B"], recent: ["a", "b", "c", "d", "e", "f", "g", "a"] });
  assert.deepEqual(loadPrefs(memory({ [storageKey("1")]: raw }), "1"), { favorites: ["A", "B"], recent: ["a", "b", "c", "d", "e"] });
});

test("storage missing or throwing: load gives empty, save says false, nothing throws", () => {
  for (const s of [null, undefined, throwing]) {
    assert.deepEqual(loadPrefs(s, "1"), { favorites: [], recent: [] });
    assert.equal(savePrefs(s, "1", { favorites: ["A"], recent: [] }), false);
  }
  assert.deepEqual(loadPrefs(memory(), ""), { favorites: [], recent: [] });
  assert.equal(savePrefs(memory(), "", { favorites: ["A"], recent: [] }), false, "no chain yet: nothing is saved");
});
