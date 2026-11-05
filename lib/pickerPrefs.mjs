// The token picker's favorites and recent list. Kept in the browser's own storage, one key per chain, never a server and never tied to a
// wallet. Every storage access is guarded: a missing or throwing storage gives empty lists and the picker works the same, in memory.

export const RECENT_CAP = 5;

/** The storage key of a Rome chain. */
export const storageKey = (chainId) => `aave:picker:v1:${chainId}`;

export const emptyPrefs = () => ({ favorites: [], recent: [] });

const uniqueStrings = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && x))] : []);

/** The lists in the shape the picker uses: strings only, no duplicates, recent capped. */
function clean(p) {
  return { favorites: uniqueStrings(p?.favorites), recent: uniqueStrings(p?.recent).slice(0, RECENT_CAP) };
}

/** Drops the mints the current token list does not know. With no list given nothing is dropped. */
export function pruneUnknown(prefs, knownMints) {
  if (!knownMints) return prefs;
  const known = new Set(knownMints);
  return { favorites: prefs.favorites.filter((m) => known.has(m)), recent: prefs.recent.filter((m) => known.has(m)) };
}

/** The saved lists of a chain; empty when nothing is saved, the storage is missing or throws, or the text is not what was saved. */
export function loadPrefs(storage, chainId, knownMints) {
  if (!storage || !chainId) return emptyPrefs();
  try {
    const raw = storage.getItem(storageKey(chainId));
    if (!raw) return emptyPrefs();
    const p = JSON.parse(raw);
    if (!p || typeof p !== "object") return emptyPrefs();
    return pruneUnknown(clean(p), knownMints);
  } catch {
    return emptyPrefs();
  }
}

/** Saves the lists. Returns false when they could not be saved (no storage, no chain yet, or the storage refused). */
export function savePrefs(storage, chainId, prefs) {
  if (!storage || !chainId) return false;
  try {
    storage.setItem(storageKey(chainId), JSON.stringify(clean(prefs)));
    return true;
  } catch {
    return false;
  }
}

/** A star pressed: the mint joins the favorites (at the end), or leaves them when it is there. */
export function toggleFavorite(prefs, mint) {
  const on = prefs.favorites.includes(mint);
  return { ...prefs, favorites: on ? prefs.favorites.filter((m) => m !== mint) : [...prefs.favorites, mint] };
}

/** A token picked: it goes to the front of recent, once, and recent keeps the newest few. */
export function pushRecent(prefs, mint, cap = RECENT_CAP) {
  if (!mint) return prefs;
  return { ...prefs, recent: [mint, ...prefs.recent.filter((m) => m !== mint)].slice(0, cap) };
}

/** Clear pressed: recent is empty, the favorites stay. */
export function clearRecent(prefs) {
  return { ...prefs, recent: [] };
}
