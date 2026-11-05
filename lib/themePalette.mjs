// Helpers for the palette test (themePalette.test.mjs): reads the colour tokens and the selectors out of app/theme.css and does the contrast
// maths. Nothing here runs in the app.

const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = toRgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
/** WCAG contrast ratio of two #RRGGBB colours. */
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

/** A translucent token "--name: rgba(r,g,b,a)" laid over a solid #RRGGBB, as the solid colour it composites to. */
export function over(rgba, bg) {
  const m = /rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)/.exec(rgba);
  if (!m) throw new Error(`not an rgba colour: ${rgba}`);
  const a = Number(m[4]), under = toRgb(bg);
  return "#" + [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + under[k] * (1 - a)).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** The rgba value of "--name" in the rule with this exact selector (the dim and line tokens are translucent, so paletteTokens skips them). */
export function rgbaToken(css, selector, name) {
  const at = css.indexOf(selector + " {");
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  const m = new RegExp(`--${name}:\\s*(rgba\\([^)]*\\))`).exec(body);
  if (!m) throw new Error(`no --${name} in ${selector}`);
  return m[1];
}

/** Every "--name: #RRGGBB" in the rule with this exact selector, as { name: "#RRGGBB" } (rgba and gradient values are not colours to test). */
export function paletteTokens(css, selector) {
  const at = css.indexOf(selector + " {");
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("\n}", at));
  const out = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})\s*[;\s]/g)) out[m[1]] = m[2].toUpperCase();
  return out;
}

/** The selector of every style rule in the file, however deeply it sits in @media / @supports (comments stripped, lists split on commas). */
export function ruleSelectors(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const walk = (text) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === "{") depth++; else if (text[j] === "}") depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@")) { if (/^@(media|supports)/.test(head)) walk(body); }
      else if (!/^(from|to|\d+%)/.test(head)) out.push(...head.split(/,(?![^(]*\))/).map((s) => s.trim()).filter(Boolean));
      i = j;
    }
  };
  walk(src);
  return out;
}
