// The Rome look is always on and DARK is the default. public/theme-init.js runs before the first
// paint, so this runs that very file against a stand-in page and checks what it puts on <html>.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { resolveEffectiveTheme, useThemeStore } from "@/store/themeStore";

const script = readFileSync(join(__dirname, "../public/theme-init.js"), "utf8");

function run(stored: string | null | "throws", osDark: boolean) {
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const bar = { content: "", setAttribute(_: string, v: string) { this.content = v; } };
  const root = {
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
    classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); } },
    style: { colorScheme: "" },
  };
  const sandbox = {
    document: { documentElement: root, querySelector: () => bar },
    window: { matchMedia: () => ({ matches: osDark }) },
    localStorage: {
      getItem: () => { if (stored === "throws") throw new Error("blocked"); return stored; },
    },
  };
  vm.runInNewContext(script, sandbox);
  return { attrs, dark: classes.has("dark"), scheme: root.style.colorScheme, bar: bar.content };
}

const choice = (preference: string) => JSON.stringify({ state: { preference }, version: 0 });

describe("theme-init.js", () => {
  it("a first visit is dark, even on a light computer", () => {
    const r = run(null, false);
    expect(r.attrs["data-rome-theme"]).toBe("dark");
    expect(r.attrs["data-theme"]).toBe("dark");
    expect(r.dark).toBe(true);
    expect(r.scheme).toBe("dark");
    expect(r.bar).toBe("#0A0421");
  });

  it("a remembered Light or Dark wins", () => {
    expect(run(choice("light"), true).attrs["data-rome-theme"]).toBe("light");
    expect(run(choice("light"), true).bar).toBe("#EFEBFB");
    expect(run(choice("dark"), false).attrs["data-rome-theme"]).toBe("dark");
  });

  it("System follows the computer", () => {
    expect(run(choice("system"), true).attrs["data-rome-theme"]).toBe("dark");
    expect(run(choice("system"), false).attrs["data-rome-theme"]).toBe("light");
  });

  it("unreadable storage or a broken value is dark", () => {
    expect(run("throws", false).attrs["data-rome-theme"]).toBe("dark");
    expect(run("{not json", false).attrs["data-rome-theme"]).toBe("dark");
  });
});

describe("theme store", () => {
  it("the default choice is Dark", () => {
    expect(useThemeStore.getState().preference).toBe("dark");
  });

  it("System resolves by the computer, the others are themselves", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
  });
});
