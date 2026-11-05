"use client";

// Resolves the effective theme from the persisted preference + OS setting,
// applies it to <html data-rome-theme="..."> so app/theme.css picks the right
// palette, and exposes the choice (light / system / dark). The no-flash initial
// paint is handled by the blocking script public/theme-init.js — this hook keeps
// the attributes in sync after hydration + when the OS theme changes under a
// "system" preference.

import { useEffect, useState } from "react";
import {
  useThemeStore,
  resolveEffectiveTheme,
  type EffectiveTheme,
} from "@/store/themeStore";

// The phone browser bar takes the page colour of each palette (theme.css --ground).
const BAR_COLOUR: Record<EffectiveTheme, string> = { light: "#EFEBFB", dark: "#0A0421" };

function applyTheme(effective: EffectiveTheme) {
  const root = document.documentElement;
  // Same attributes as public/theme-init.js. data-rome-theme is the hook theme.css reads;
  // data-theme is the one this app's styles.css has always used.
  root.setAttribute("data-rome-theme", effective);
  root.setAttribute("data-theme", effective);
  root.classList.toggle("dark", effective === "dark");
  root.style.colorScheme = effective;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLOUR[effective]);
}

export function useTheme() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  // Seed with "dark" — the value the SERVER renders (no document there). The
  // client's FIRST render MUST match the server's, or React throws hydration
  // mismatch #418 for theme-dependent nodes (the logo <img src>, the sun/moon
  // toggle icon). The effect below corrects to the real theme immediately
  // post-mount: a dark-default user sees no change; a light user sees a single
  // frame before the swap. (data-theme itself is already correct pre-paint via
  // the blocking script in layout.tsx, so page colors never flash — only the
  // JS-driven logo/icon glyph does, for one frame.)
  const [effective, setEffective] = useState<EffectiveTheme>("dark");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const compute = () => {
      const eff = resolveEffectiveTheme(preference, media.matches);
      setEffective(eff);
      applyTheme(eff);
    };
    compute();
    // Only follow OS changes while the user hasn't picked an explicit theme.
    if (preference === "system") {
      media.addEventListener("change", compute);
      return () => media.removeEventListener("change", compute);
    }
  }, [preference]);

  const toggle = () =>
    setPreference(effective === "dark" ? "light" : "dark");

  return { theme: effective, toggle, preference, setPreference };
}
