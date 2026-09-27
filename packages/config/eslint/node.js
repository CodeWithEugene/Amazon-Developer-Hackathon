import globals from "globals"

import { config as baseConfig } from "./base.js"

/**
 * ESLint configuration for Node.js packages and Lambda handlers.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export const config = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
]
