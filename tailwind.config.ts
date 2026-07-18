import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: [
          "Georgia",
          "Iowan Old Style",
          "Palatino Linotype",
          "Georgia",
          "serif",
        ],
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "IBM Plex Mono",
          "ui-monospace",
          "SF Mono",
          "Menlo",
          "monospace",
        ],
      },
      colors: {
        "rome-purple": "var(--rome-purple)",
        "rome-purple-hover": "var(--rome-purple-hover)",
        "rome-cream": "var(--rome-cream)",
        "rome-paper": "var(--rome-paper)",
        "rome-ink": "var(--rome-ink)",
        "rome-stone-50": "var(--rome-stone-50)",
        "rome-stone-100": "var(--rome-stone-100)",
        "rome-stone-200": "var(--rome-stone-200)",
        "rome-stone-400": "var(--rome-stone-400)",
      },
    },
  },
  plugins: [],
};
export default config;
