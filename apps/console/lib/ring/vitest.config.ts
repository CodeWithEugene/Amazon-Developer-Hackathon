import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

/**
 * Unit tests for the console's Ring live-mode modules. Run from the repo
 * root: `pnpm exec vitest run --config apps/console/lib/ring/vitest.config.ts`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./testing/server-only.ts", import.meta.url)),
      "@": fileURLToPath(new URL("../..", import.meta.url)),
    },
  },
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["**/*.test.ts"],
    environment: "node",
  },
})
