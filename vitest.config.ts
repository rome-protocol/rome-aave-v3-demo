import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";

// The app imports through the `@/` alias (tsconfig paths); vitest needs the same
// mapping or any module under lib/ that reaches across folders fails to resolve.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    passWithNoTests: true,
    // The palette test uses node:test and runs in CI as `node --test lib/themePalette.test.mjs`.
    exclude: [...configDefaults.exclude, "lib/themePalette.test.mjs"],
  },
});
