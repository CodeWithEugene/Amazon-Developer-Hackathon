import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^server-only$/, replacement: here("./test/stubs/server-only.ts") },
      { find: /^@workspace\/ui\/(.*)$/, replacement: here("../../packages/ui/src/$1") },
      { find: /^@\/(.*)$/, replacement: here("./$1") },
    ],
  },
  test: {
    include: ["test/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
})
