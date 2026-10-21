import "server-only"

import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

/**
 * Resolves the monorepo root by walking up from the working directory to
 * the folder holding `pnpm-workspace.yaml`, so the console finds the shared
 * demo store whether it runs from the repo root or from apps/console.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = resolve(start)
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

/**
 * The local store directory: `VISITPROOF_DEMO_STORE_PATH` when set
 * (relative paths resolve against the repo root, like scripts/demo.ts),
 * otherwise `<repo root>/.demo-data`.
 */
export function storeDir(): string {
  const configured = process.env.VISITPROOF_DEMO_STORE_PATH
  const root = findRepoRoot()
  if (!configured) return join(root, ".demo-data")
  return isAbsolute(configured) ? configured : resolve(root, configured)
}
