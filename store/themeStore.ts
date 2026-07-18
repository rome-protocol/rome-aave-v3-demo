// Theme preference store — lifted from the Rome web app's themeStore, adapted for the
// Aave demo. The demo's public/styles.css switches palettes via the
// `html[data-theme="light"]` attribute (dark is the `:root` default), so the
// effective theme is applied as a data-theme attribute (see hooks/useTheme.ts),
// not the `.dark` class the Rome web app uses.

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
      preference: "system",
      setPreference: (preference) => set({ preference }),
    }),
    {
      // Distinct from the Rome web app's "the Rome web app-theme" so the two apps don't share
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
