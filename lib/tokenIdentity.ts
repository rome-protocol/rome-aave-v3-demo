"use client";
// Who a token is, on the client: its symbol, its name and whether a logo exists, read by mint from the app's own /api/token (one read per mint).
// Nothing here loads an image: the logo path points at the app's own origin. One small store shared by every TokenIcon, so a screen draws its
// marks from one answer and a mark never flickers between screens.

import { useEffect, useSyncExternalStore } from "react";

export interface TokenIdentity { mint: string; symbol: string; name: string; source: string; logo: boolean }

type Slot = { state: "loading" | "ok" | "failed"; at: number; value: TokenIdentity | null };

const RETRY_AFTER_MS = 30_000;
const slots = new Map<string, Slot>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

/** The app's own address of a token's logo. */
export const logoUrl = (mint: string) => `/api/token/logo?mint=${encodeURIComponent(mint)}`;

const stale = (s: Slot | undefined) => !s || (s.state === "failed" && Date.now() - s.at > RETRY_AFTER_MS);

function ensureMint(mint: string) {
  if (!stale(slots.get(mint))) return;
  slots.set(mint, { state: "loading", at: Date.now(), value: null });
  fetch(`/api/token?mint=${encodeURIComponent(mint)}`)
    .then(async (r) => {
      if (r.status === 404) return slots.set(mint, { state: "ok", at: Date.now(), value: null }); // not a token: a letter, and no asking again
      if (!r.ok) throw new Error("token");
      const b = (await r.json()) as TokenIdentity;
      slots.set(mint, { state: "ok", at: Date.now(), value: { mint: b.mint, symbol: b.symbol, name: b.name, source: b.source, logo: !!b.logo } });
    })
    .catch(() => slots.set(mint, { state: "failed", at: Date.now(), value: null }))
    .finally(bump);
}

/** The identity of a mint from what has been read so far; null until then (and when there is none). */
export const lookupIdentity = (mint: string): TokenIdentity | null => slots.get(mint)?.value ?? null;

/** The identities of several mints at once (a list of assets). Starts the reads that have not been made; re-renders when an answer arrives. */
export function useTokenIdentities(mints: (string | null | undefined)[]): (TokenIdentity | null)[] {
  useSyncExternalStore(subscribe, () => version, () => 0);
  const key = mints.join(",");
  useEffect(() => { mints.forEach((m) => { if (m) ensureMint(m); }); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return mints.map((m) => (m ? lookupIdentity(m) : null));
}

/** The identity of a token by mint. */
export const useTokenIdentity = (mint: string | null | undefined): TokenIdentity | null => useTokenIdentities([mint])[0] ?? null;

/** For tests: forget everything read. */
export function resetTokenIdentities() {
  slots.clear();
  bump();
}
