// Theme preference store — lifted from rome-ui's themeStore, adapted for the
// Aave demo. The Rome app look (app/theme.css) reads `html[data-rome-theme]`,
// so the effective theme is applied as attributes on <html> (see
// hooks/useTheme.ts). DARK (Aurora) is the default for a first-time visitor;
// the choice (light, system, dark) is remembered in localStorage.

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type ThemePreference = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "dark",
      setPreference: (preference) => set({ preference }),
    }),
    {
      // Distinct from rome-ui's "rome-ui-theme" so the two apps don't share
      // a preference when served from sibling origins during local dev.
      name: "rome-aave-theme",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function resolveEffectiveTheme(
  preference: ThemePreference,
  osPrefersDark: boolean,
): EffectiveTheme {
  if (preference === "system") return osPrefersDark ? "dark" : "light";
  return preference;
}
