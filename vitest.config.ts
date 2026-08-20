import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The tests import server utils directly (they're pure modules), so vitest
// needs the same `#server/*` alias Nuxt provides at build time. Without it,
// any *value* import through the alias fails to resolve — type-only imports
// happen to work because they're erased before resolution.
export default defineConfig({
  resolve: {
    alias: {
      "#server": fileURLToPath(new URL("./server", import.meta.url)),
    },
  },
});
