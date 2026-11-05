"use client";

// The Rome app's Light / System / Dark choice (the DEX's Theme.tsx: ThemeChoice, ThemeRow, ThemeButton), on this app's
// theme store. No feature switch: the choice is always there. It is remembered in localStorage (store/themeStore.ts) and
// applied to <html> by hooks/useTheme.ts; public/theme-init.js paints it before the first frame.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconMonitor, IconMoon, IconSun } from "@/components/icons";
import { useTheme } from "@/hooks/useTheme";
import type { ThemePreference } from "@/store/themeStore";

const OPTIONS: { id: ThemePreference; label: string; icon: ReactNode }[] = [
  { id: "light", label: "Light", icon: <IconSun size={13} /> },
  { id: "system", label: "System", icon: <IconMonitor size={13} /> },
  { id: "dark", label: "Dark", icon: <IconMoon size={13} /> },
];

/** The three-way choice, in the shape of the Rome app's account-menu Theme row. */
export function ThemeChoice() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="theme-choice" role="group" aria-label="Theme" data-testid="theme-choice">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" aria-pressed={preference === o.id} data-testid={`theme-${o.id}`} onClick={() => setPreference(o.id)}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}

/** The Theme block inside a menu: a small heading and the choice. */
export function ThemeRow() {
  return (
    <div className="theme-row" data-testid="theme-row">
      <span className="eyebrow">Theme</span>
      <ThemeChoice />
    </div>
  );
}

/** The header button that opens the choice in a small menu (wide screens; on a phone the page menu carries the choice). */
export function ThemeButton() {
  const { preference } = useTheme();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLElement>("button")?.focus(); } };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const Icon = preference === "light" ? IconSun : preference === "system" ? IconMonitor : IconMoon;
  return (
    <div className="account-root hdr-theme" ref={root}>
      <button type="button" className="menu-btn theme-btn" data-testid="theme-button" aria-haspopup="true" aria-expanded={open} aria-label="Theme"
        style={{ width: 36, height: 36 }} onClick={() => setOpen((o) => !o)}>
        <Icon size={16} />
      </button>
      {open && <div className="account-menu theme-pop" data-testid="theme-pop"><ThemeRow /></div>}
    </div>
  );
}
