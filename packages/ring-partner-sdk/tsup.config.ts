import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/whep.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
