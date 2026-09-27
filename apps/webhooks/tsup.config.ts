import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/lambda.ts", "src/server.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
})
