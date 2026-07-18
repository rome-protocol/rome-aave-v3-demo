// No-flash theme init. Loaded render-blocking in <head> (no async/defer) so
// data-theme is set before first paint — avoids a dark→light flash on load.
// Reads the zustand-persisted preference ({ state: { preference }, version })
// or falls back to the OS color-scheme. Plain static asset (not inline) to
// keep the document CSP-clean.
(function () {
  try {
    var stored = localStorage.getItem("rome-aave-theme");
    var pref = stored ? JSON.parse(stored).state.preference : "system";
    var dark =
      pref === "dark" ||
      (pref !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
})();
