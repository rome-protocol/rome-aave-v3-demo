"use client";

// The token picker window of the Rome DEX (components/TokenPicker.tsx there), for the flash-loan asset choice: a search box, favorites (a star on each
// row; starred tokens are chips at the top), a short Recent list with Clear, and the rows. Favorites and recent are kept in this browser only, one key
// per chain (lib/pickerPrefs.mjs), through guarded storage. Only the app's listed assets are offered: Aave can only flash-loan listed reserves, so there
// is no pasted address. It is the app's shared Dialog (role=dialog, aria-modal, labelled by its title, a labelled close button; Escape, focus return and the focus trap come from it).
import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/Dialog";
import { TokenIcon } from "@/components/TokenIcon";
import { IconCheck, IconChevronDown, IconClose } from "@/components/icons";
import { filterTokens } from "@/lib/tokenSearch.mjs";
import { clearRecent, emptyPrefs, loadPrefs, pushRecent, savePrefs, toggleFavorite } from "@/lib/pickerPrefs.mjs";
import { DEFAULT_CHAIN_ID } from "@/lib/registry-config";

/** `mint` is the id the lists are kept by: the Solana mint, or the contract address of a plain ERC-20. */
export interface PickerToken { mint: string; symbol: string; name: string; detail?: string; logoMint?: string | null }

const CHAIN = String(DEFAULT_CHAIN_ID);

/** The browser's storage, or null where it is blocked (reading the property itself can throw). */
function browserStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

const StarIcon = ({ on }: { on: boolean }) => (
  <svg className="ico" width={18} height={18} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m12 3.2 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17.1l-5.4 2.9 1-6.1L3.2 9.6l6.1-.9z" />
  </svg>
);

const SearchIcon = () => (
  <svg className="ico" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" focusable="false">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);

export function TokenPickerModal({ title = "Select token", tokens, selectedMint, onPick, onClose }: {
  title?: string; tokens: PickerToken[]; selectedMint?: string; onPick: (t: PickerToken) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [prefs, setPrefs] = useState<{ favorites: string[]; recent: string[] }>(emptyPrefs);
  // Favorites and recent from this browser's storage. A token the app no longer lists is dropped.
  const knownKey = tokens.map((t) => t.mint).join(",");
  useEffect(() => { setPrefs(loadPrefs(browserStorage(), CHAIN, knownKey ? knownKey.split(",") : undefined)); }, [knownKey]);
  const changePrefs = (next: typeof prefs) => { setPrefs(next); savePrefs(browserStorage(), CHAIN, next); };

  const shown = filterTokens(tokens, query) as PickerToken[];
  const byMint = (mints: string[]) => mints.flatMap((m) => { const t = tokens.find((n) => n.mint === m); return t ? [t] : []; });
  const favTokens = byMint(prefs.favorites);
  const recentTokens = byMint(prefs.recent);
  const choose = (t: PickerToken) => { changePrefs(pushRecent(prefs, t.mint)); onPick(t); };
  const q = query.trim();

  // A row is the pick button and, beside it (never inside it), the favorite star: the star does not pick the row.
  const row = (t: PickerToken) => {
    const fav = prefs.favorites.includes(t.mint);
    return (
      <div key={t.mint} className="trow-wrap" role="listitem" data-selected={t.mint === selectedMint}>
        <button type="button" className="trow" data-testid={`token-row-${t.symbol}`} aria-pressed={t.mint === selectedMint} onClick={() => choose(t)}>
          <TokenIcon symbol={t.symbol} mint={t.logoMint} size={34} />
          <span className="trow-id">
            <span className="trow-sym">{t.symbol}</span>
            <span className="trow-name">{t.name && t.name !== t.symbol ? t.name : " "}</span>
          </span>
          {t.detail ? <span className="trow-end"><span className="trow-bal mono">{t.detail}</span></span> : null}
          {t.mint === selectedMint && <span className="trow-tick"><IconCheck size={16} /></span>}
        </button>
        <button type="button" className="tstar" data-testid={`token-star-${t.symbol}`} aria-pressed={fav} aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          onClick={() => changePrefs(toggleFavorite(prefs, t.mint))}><StarIcon on={fav} /></button>
      </div>
    );
  };
  const chip = (t: PickerToken, kind: "fav" | "recent") => (
    <button key={t.mint} type="button" className="tchip" data-testid={`token-${kind}-${t.symbol}`} onClick={() => choose(t)}>
      <TokenIcon symbol={t.symbol} mint={t.logoMint} size={20} /><span>{t.symbol}</span>
    </button>
  );

  // The Dialog renders into document.body itself, so a blurred card never becomes the containing block of the window.
  return (
    <Dialog title={title} width={420} onClose={onClose} testid="token-picker" closeTestid="token-picker-close">
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <label className="tsearch">
        <SearchIcon />
        <input ref={searchRef} data-testid="token-search" data-autofocus aria-label="Search tokens" autoComplete="off" spellCheck={false}
          placeholder="Name or symbol" value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button type="button" className="tsearch-x" data-testid="token-search-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><IconClose size={14} /></button>}
      </label>
      {!q && favTokens.length > 0 && (
        <div className="tquick" data-testid="token-favorites" role="group" aria-label="Favorites">
          <div className="tchips">{favTokens.map((t) => chip(t, "fav"))}</div>
        </div>
      )}
      {!q && recentTokens.length > 0 && (
        <div className="tquick" data-testid="token-recent" role="group" aria-label="Recent">
          <div className="tquick-head">
            <span className="tquick-label">Recent</span>
            <button type="button" className="tquick-clear" data-testid="token-recent-clear" onClick={() => { changePrefs(clearRecent(prefs)); searchRef.current?.focus(); }}>Clear</button>
          </div>
          <div className="tchips">{recentTokens.map((t) => chip(t, "recent"))}</div>
        </div>
      )}
      <div className="tlist" data-testid="token-list" role="list" style={{ marginTop: 0 }}>
        {shown.map(row)}
        {!shown.length && <div className="tnote" data-testid="token-empty">No token matches that.</div>}
      </div>
      </div>
    </Dialog>
  );
}

/** The asset button of the flash-loan form: the mark, the symbol, the name and a chevron. It opens the picker. */
export function TokenButton({ token, onClick, ariaLabel }: { token: PickerToken; onClick: () => void; ariaLabel: string }) {
  return (
    <button type="button" className="tbtn tbtn-block" data-testid="token-button" aria-label={`${ariaLabel}: ${token.symbol}`} aria-haspopup="dialog" onClick={onClick}>
      <TokenIcon symbol={token.symbol} mint={token.logoMint} size={26} />
      <span className="tbtn-sym">
        <span style={{ display: "block", fontWeight: 600 }}>{token.symbol}</span>
        {token.name && token.name !== token.symbol ? <span style={{ display: "block", fontWeight: 400, fontSize: 12, color: "var(--fg2)" }}>{token.name}</span> : null}
      </span>
      <span className="tbtn-chev" style={{ display: "inline-flex" }}><IconChevronDown size={14} /></span>
    </button>
  );
}
