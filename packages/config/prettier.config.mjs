import { fileURLToPath } from "node:url"

/** Resolved from this file so it works from any workspace and through the pnpm symlink. */
const tailwindStylesheet = fileURLToPath(
  new URL("../ui/src/styles/globals.css", import.meta.url)
)

/** @type {import("prettier").Config} */
const config = {
  endOfLine: "lf",
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  printWidth: 80,
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet,
  tailwindFunctions: ["cn", "cva"],
}

export default config
