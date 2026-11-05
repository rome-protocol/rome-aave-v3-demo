// The two palettes in app/theme.css (Aurora dark, Daylight light): readability, not brand mixing. Every text/background pair and every hover pair
// meets WCAG AA (4.5:1 text, 3:1 large text and UI edges), including text over the brightest part of the background field.
// Also: every themed rule stays under :root[data-rome-theme], so nothing restyles the page before the theme attribute is set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { contrast, over, paletteTokens, rgbaToken, ruleSelectors } from "./themePalette.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../app/theme.css"), "utf8");
const globals = readFileSync(join(here, "../app/globals.css"), "utf8");
const palettes = { light: paletteTokens(css, ':root[data-rome-theme="light"]'), dark: paletteTokens(css, ':root[data-rome-theme="dark"]') };
const shared = paletteTokens(css, ":root[data-rome-theme]");

// a token's value in a palette (a lane colour a palette leaves alone is the DEX's own, from globals.css)
const val = (t, name) => {
  if (t[name]) return t[name];
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(globals);
  assert.ok(m, `--${name} is defined`);
  return m[1].toUpperCase();
};
const ratio = (t, fg, bg) => contrast(val(t, fg), val(t, bg));
const atLeast = (t, fg, bg, min) => { const r = ratio(t, fg, bg); assert.ok(r >= min, `--${fg} on --${bg} is ${r.toFixed(2)}:1, needs ${min}:1`); };

const SURFACES = ["ground", "panel", "panel-2", "panel-3", "hover", "chip-bg", "btn2-bg", "tip-bg", "sel-soft"];
const FIELD = ["field-1", "field-2", "field-3"]; // the strongest colours of the three lights behind the page

for (const [mode, t] of Object.entries(palettes)) {
  test(`${mode}: ink, muted and faint text are 4.5:1 on every surface and over every light of the field`, () => {
    for (const fg of ["ink", "muted", "faint"]) for (const bg of [...SURFACES, ...FIELD]) atLeast(t, fg, bg, 4.5);
  });

  test(`${mode}: links, status and lane colours are 4.5:1 on the cards and inset surfaces`, () => {
    for (const fg of ["bridge", "up-text", "down", "warn", "evm", "sol"]) for (const bg of ["ground", "panel", "panel-2", "panel-3"]) atLeast(t, fg, bg, 4.5);
    for (const bg of FIELD) atLeast(t, "bridge", bg, 4.5);
  });

  test(`${mode}: the primary gradient, the flat button and their hovers carry white at 4.5:1, at every stop`, () => {
    for (const bg of ["btn", "btn-hover", "btn-1", "btn-2", "btn-3", "btn-h1", "btn-h2", "btn-h3"]) atLeast(t, "on-btn", bg, 4.5);
  });

  test(`${mode}: chosen states, chips, rows, secondary buttons (and their hovers) and tooltips read at 4.5:1`, () => {
    const pairs = [["sel-ink", "sel-bg"], ["ink", "sel-soft"], ["ink", "hover"], ["ink", "btn2-bg"], ["ink", "btn2-hover"], ["muted", "btn2-hover"], ["ink", "chip-bg"], ["muted", "chip-bg"], ["ink", "tip-bg"], ["muted", "tip-bg"], ["bridge", "hover"], ["bridge", "chip-bg"]];
    for (const [fg, bg] of pairs) atLeast(t, fg, bg, 4.5);
  });

  test(`${mode}: UI edges and large figures reach 3:1 (focus ring, chosen state, chart line and bars, chart text 4.5:1)`, () => {
    for (const bg of ["ground", "panel", "panel-2"]) atLeast(t, "ring", bg, 3);
    // a secondary button (white on a white dialog in light) is told apart by its edge alone
    for (const bg of ["ground", "panel", "panel-2", "btn2-bg"]) atLeast(t, "btn2-edge", bg, 3);
    // chips and small buttons (settings chip, Max, fee tiers, token pills, menu buttons) share that edge, and their hover edge too
    for (const bg of ["ground", "panel", "panel-2", "chip-bg"]) { atLeast(t, "btn2-edge", bg, 3); atLeast(t, "ring", bg, 3); }
    // the chosen pill is its own fill or carries an edge that reaches 3:1 against the page
    assert.ok(Math.max(ratio(t, "sel-bg", "ground"), ratio(t, "sel-line", "ground")) >= 3, "the chosen state is 3:1 against the page");
    for (const c of [t["chart-b-edge"] ? "chart-b-edge" : "chart-b", "chart-a", "chart-up", "chart-down"]) atLeast(t, c, "panel", 3);
    atLeast(t, "chart-ink", "panel", 4.5);
  });
}

test("the token letter marks carry white letters at 4.5:1 in both modes", () => {
  for (let i = 0; i < 6; i++) assert.ok(contrast("#FFFFFF", shared[`mark-${i}`]) >= 4.5, `--mark-${i} ${shared[`mark-${i}`]}`);
});

test("light is a light page with white cards, dark is a dark page; both define the field, the glass card and the primary gradient", () => {
  assert.ok(contrast(palettes.light.ground, "#FFFFFF") < 1.2 && contrast(palettes.dark.ground, "#000000") < 1.5);
  for (const mode of ["light", "dark"]) {
    const block = css.slice(css.indexOf(`:root[data-rome-theme="${mode}"] {`), css.indexOf("\n}", css.indexOf(`:root[data-rome-theme="${mode}"] {`)));
    for (const name of ["--field:", "--thread:", "--card-bg:", "--card-solid:", "--card-edge:", "--card-shadow:", "--card-blur:", "--card-blur-sm:", "--btn-shadow:"]) assert.ok(block.includes(name), `${mode} sets ${name}`);
  }
});

// A rule outside :root[data-rome-theme] would restyle the page before the theme attribute is set. Only the markup of the Theme choice itself
// and the default chart colours are allowed.
test("every rule in theme.css sits under :root[data-rome-theme] (the Theme choice's own classes and the chart defaults excepted)", () => {
  const allowed = [/^:root$/, /^:root\[data-rome-theme/, /^\.theme-(row|choice|pop|btn-root)\b/, /^\.menu-panel \.theme-row$/];
  const sels = ruleSelectors(css);
  assert.ok(sels.length > 100, "rules found");
  for (const s of sels) assert.ok(allowed.some((re) => re.test(s)), `unscoped selector in theme.css: ${s}`);
  assert.ok(sels.some((s) => /body::before/.test(s)), "the field layer is a themed rule");
});

test("the look has its fallbacks: lighter blur on phones, solid cards without blur support and under reduced transparency", () => {
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*--card-blur-sm/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(css, /var\(--card-solid\)/);
});

// ───────── layout and copy ─────────
for (const [mode, t] of Object.entries(palettes)) {
  test(`${mode}: the APR figure is 4.5:1 on the cards, and its bar reaches 3:1 against its track`, () => {
    for (const bg of ["ground", "panel", "panel-2", ...FIELD]) atLeast(t, "apr", bg, 4.5);
    atLeast(t, "apr-bar", "apr-track", 3);
    // never red or pink: the figure sits next to a red 7-day line and a "down" colour
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(t.apr.slice(i, i + 2), 16));
    assert.ok(b >= r && b >= g * 0.8, `--apr ${t.apr} leans blue or green, not red`);
  });

  test(`${mode}: the gradient title is large text, 3:1 or better at every stop over the page and the field`, () => {
    for (const stop of ["title-1", "title-2", "title-3"]) for (const bg of ["ground", ...FIELD]) atLeast(t, stop, bg, 3);
  });
}

test("the gradient title is on .sc-head h2 and the swap headline only, never on every h1 or h2", () => {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").split("}").filter((r) => /background-clip:\s*text/.test(r));
  assert.ok(rules.length >= 1, "a gradient title rule exists");
  for (const r of rules) {
    const sel = r.slice(0, r.indexOf("{")).trim();
    assert.match(sel, /^(:root\[data-rome-theme\] \.sc-head h2|:root\[data-rome-theme\] \.lead-title)(,\s*:root\[data-rome-theme\] (\.sc-head h2|\.lead-title))?$/, `gradient on: ${sel}`);
  }
});

test("headline figures are DM Sans Bold (stat tiles, chart headline, pool figures); amounts stay Plex Mono", () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(body, /\.stat \.v[^{]*\{[^}]*font-family:\s*var\(--sans\)[^}]*font-weight:\s*700/);
  assert.match(body, /\.chartcard \.big[^{]*\{[^}]*font-family:\s*var\(--sans\)/);
  assert.match(body, /\.kv \.c\.fig \.v[^{]*\{[^}]*font-family:\s*var\(--sans\)/);
  assert.doesNotMatch(body, /\.stat \.v[^{]*\{[^}]*text-shadow:(?!\s*none)/, "no glow behind money figures");
  assert.doesNotMatch(body, /\.(tbl|amount)[^{]*\{[^}]*font-family:\s*var\(--sans\)/, "tables and amounts keep the mono font");
});

// ───────── status and lane colours over the field, and over their own tinted notes (review fix) ─────────
const SEL = { light: ':root[data-rome-theme="light"]', dark: ':root[data-rome-theme="dark"]' };
for (const [mode, t] of Object.entries(palettes)) {
  test(`${mode}: up, up-text, down, warn, evm and sol are 4.5:1 straight on every light of the field`, () => {
    for (const fg of ["up", "up-text", "down", "warn", "evm", "sol"]) for (const bg of FIELD) atLeast(t, fg, bg, 4.5);
  });

  test(`${mode}: status and lane text is 4.5:1 on its own tint, laid over a panel well or any light of the field`, () => {
    const pairs = [["up-text", "up-dim"], ["down", "down-dim"], ["evm", "evm-dim"], ["sol", "sol-dim"]];
    for (const [fg, dim] of pairs) {
      const tint = rgbaToken(css, SEL[mode], dim);
      for (const bg of ["panel", "panel-2", "panel-3", ...FIELD]) {
        const r = contrast(val(t, fg), over(tint, val(t, bg)));
        assert.ok(r >= 4.5, `--${fg} on --${dim} over --${bg} is ${r.toFixed(2)}:1, needs 4.5:1`);
      }
    }
  });
}

test("a note's tint sits on a solid well, so its text reads the same wherever the card sits over the field", () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const sel of [".note.ok", ".note.err", ".tnote-bad"]) {
    const re = new RegExp(`:root\\[data-rome-theme\\] ${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^{]*\\{[^}]*background:[^;}]*var\\(--panel-2\\)`);
    assert.match(body, re, `${sel} is laid over var(--panel-2) under the theme, not left translucent`);
  }
});

test("the 'live' tick in the provenance line is --up-text under the theme", () => {
  assert.match(css.replace(/\/\*[\s\S]*?\*\//g, ""), /:root\[data-rome-theme\] \.provenance \.live\s*\{[^}]*color:\s*var\(--up-text\)/);
});

// every themed control whose edge is what marks it, as the selector the theme styles it by
const CONTROLS = [".btn.ghost", ".chip", ".tier-chip", ".tbtn", ".pf-chip", ".token-pill", ".tselect", ".hop", ".balance-row button", ".flip-inline", ".swap-flip button",
  ".menu-btn", ".dlg-close", ".am-icon", ".wpill", ".msel-btn", ".pf-custom", ".tbtn-block", ".chooser-item", ".market-select", ".in", ".tsearch", ".amount-row", ".tokenrow",
  "div.seg", ".seg-ctrl", ".theme-choice", ".pools-search input", ".sched-f input", ".liq-tier:not([aria-current=\"page\"])", ".liq-flip"];
const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1].split(/,(?![^(]*\))/).map((x) => x.trim().replace(/^:root\[data-rome-theme(?:="\w+")?\]\s*/, "")), body: m[2] }));
const edgeOf = (body) => [...body.matchAll(/(?:^|;)\s*border(?:-color)?\s*:([^;]*)/g)].map((m) => m[1]).filter((v) => /var\(--|#|rgb|color-mix/.test(v));
const BAD_EDGE = /var\(--line(?:-2|-strong)?\)/;

test("every themed control takes its base edge from --btn2-edge, never --line or --line-strong, and its hover and focus edge is --ring", () => {
  for (const c of CONTROLS) {
    const base = rules.filter((r) => r.sels.includes(c) && edgeOf(r.body).length);
    assert.ok(base.length, `${c} has a base edge rule`);
    const last = edgeOf(base[base.length - 1].body).pop();
    assert.match(last, /var\(--btn2-edge\)/, `${c} base edge is ${last.trim()}`);
    for (const r of rules) for (const s of r.sels) {
      if (!s.startsWith(c) || s === c) continue;
      if (!/:(hover|focus|focus-visible|focus-within)|\[aria-expanded/.test(s.slice(c.length))) continue;
      for (const e of edgeOf(r.body)) assert.match(e, /var\(--(ring|btn2-edge)\)/, `${s} edge is ${e.trim()}, never lighter than the base`);
    }
  }
  for (const r of rules) for (const s of r.sels) if (/:hover/.test(s) && /\.(chip|tier-chip|tbtn|pf-chip|menu-btn|wpill|msel-btn|market-select|chooser-item|in|amount-row)\b/.test(s)) for (const e of edgeOf(r.body)) assert.doesNotMatch(e, BAD_EDGE, `${s} hover edge ${e.trim()}`);
});

test("the segment container (div.seg, .seg-ctrl) draws the pill; a segment button inside .seg-ctrl keeps globals.css' no border and clear background", () => {
  const bare = rules.filter((r) => r.sels.includes(".seg") && /border|background/.test(r.body));
  assert.equal(bare.length, 0, "no themed rule paints a bare .seg (it would also paint the buttons of .seg-ctrl)");
  assert.match(globals, /\.seg-ctrl \.seg \{[^}]*border:none; background:transparent/);
});

test("the Try again ghost inside an error note has an edge that is 3:1 on the note's own tint, in both looks", () => {
  const r = rules.find((x) => x.sels.includes(".note.err .btn.ghost"));
  assert.ok(r, "there is a .note.err .btn.ghost rule");
  assert.match(r.body, /border-color:\s*var\(--down\)/);
  for (const [mode, t] of Object.entries(palettes)) {
    const tint = /--down-dim:\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(css.slice(css.indexOf(`:root[data-rome-theme="${mode}"] {`)));
    assert.ok(tint, `${mode}: --down-dim is an rgba`);
    const a = Number(tint[4]);
    for (const under of ["panel", "panel-2", "ground"]) {
      const u = val(t, under), px = [1, 3, 5].map((i) => parseInt(u.slice(i, i + 2), 16));
      const note = "#" + [1, 2, 3].map((k, i) => Math.round(Number(tint[k]) * a + px[i] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
      const c = contrast(t.down, note);
      assert.ok(c >= 3, `${mode}: the error edge on the note over --${under} is ${c.toFixed(2)}:1`);
    }
  }
});
