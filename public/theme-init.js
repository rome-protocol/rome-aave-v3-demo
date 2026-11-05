// No-flash theme init. Loaded render-blocking in <head> (no async/defer) so
// the theme is on <html> before first paint. DARK (Aurora) is the default: a
// first-time visitor, or anyone whose stored choice cannot be read, gets dark.
// A stored choice is the zustand-persisted preference ({ state: { preference },
// version }): "light", "dark", or "system" (follows the OS colour scheme).
// Plain static asset (not inline) to keep the document CSP-clean.
// Keep in step with hooks/useTheme.ts applyTheme (same attributes) and
// lib/theme-init.test.ts, which runs this file.
(function () {
  var theme = "dark";
  try {
    var stored = localStorage.getItem("rome-aave-theme");
    var pref = stored ? JSON.parse(stored).state.preference : "dark";
    if (pref === "light") theme = "light";
    else if (pref === "system") {
      theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
  } catch (e) {
    theme = "dark";
  }
  var root = document.documentElement;
  // data-rome-theme is the hook theme.css reads; data-theme is the one this app's styles.css has always used.
  root.setAttribute("data-rome-theme", theme);
  root.setAttribute("data-theme", theme);
  if (root.classList) root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  var bar = document.querySelector && document.querySelector("meta[name=\"theme-color\"]");
  if (bar) bar.setAttribute("content", theme === "dark" ? "#0A0421" : "#EFEBFB");
})();
