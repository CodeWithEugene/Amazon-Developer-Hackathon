import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
