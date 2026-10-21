/**
 * Demo configuration from the environment (Zod at the boundary). Every port
 * and the store path can be overridden so a second copy of the demo can run
 * beside the first: PORT (console), WEBHOOK_PORT, MCP_PORT, and
 * VISITPROOF_DEMO_STORE_PATH.
 */
import { readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"

import { z } from "zod"

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))
export const AGENCY_ID = "a1"
export const TIME_ZONE = "America/New_York"
/** Matches apps/console/lib/store/ledger.ts and apps/webhooks/src/server.ts. */
export const DEMO_LEDGER_SECRET = "visitproof-local-demo-ledger"
const DEMO_SIGNING_KEY = "visitproof-demo-signing-key"

const port = (fallback: number) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.coerce.number().int().min(1).max(65_535).default(fallback)
  )

const envSchema = z.object({
  PORT: port(3000),
  WEBHOOK_PORT: port(3101),
  MCP_PORT: port(8000),
  VISITPROOF_DEMO_STORE_PATH: z.string().trim().optional(),
  RING_HMAC_SIGNING_KEY: z.string().trim().optional(),
  VISITPROOF_LEDGER_SECRET: z.string().trim().optional(),
  /** "now" stops the replay at the wall clock; the default settles every visit. */
  VISITPROOF_DEMO_UNTIL: z.enum(["end", "now"]).default("end"),
})

/**
 * The only keys the demo takes from the repository's .env (live Ring mode
 * for the console's device check and live view). Everything else in .env,
 * such as AWS keys or MODEL_PROVIDER, is ignored so the demo stays offline.
 */
export const DOTENV_PASSTHROUGH = [
  "RING_PLAYGROUND_ACCESS_TOKEN",
  "RING_API_BASE",
  "VISITPROOF_TOKEN_KEY",
] as const

/** Allowed .env values not already set in the environment. VISITPROOF_DEMO_DOTENV=0 skips the file. */
export function dotenvPassthrough(
  root: string,
  env: NodeJS.ProcessEnv
): Record<string, string> {
  if (env.VISITPROOF_DEMO_DOTENV === "0") return {}
  let text: string
  try {
    text = readFileSync(join(root, ".env"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw error
  }
  const parsed = parseEnv(text)
  return Object.fromEntries(
    DOTENV_PASSTHROUGH.flatMap((key) => {
      const value = parsed[key]?.trim()
      return value && !env[key] ? [[key, value]] : []
    })
  )
}

export interface DemoConfig {
  readonly root: string
  readonly storeDir: string
  readonly consolePort: number
  readonly webhookPort: number
  readonly mcpPort: number
  readonly signingKey: string
  readonly ledgerSecret: string
  readonly until: "end" | "now"
  /** Allowed keys from .env, passed to the console only. */
  readonly passthrough: Readonly<Record<string, string>>
}

const nonEmpty = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value

export function readDemoConfig(env: NodeJS.ProcessEnv): DemoConfig {
  const parsed = envSchema.parse(env)
  const configured = nonEmpty(parsed.VISITPROOF_DEMO_STORE_PATH)
  const storeDir = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(ROOT, configured)
    : join(ROOT, ".demo-data")
  const ports = [parsed.PORT, parsed.WEBHOOK_PORT, parsed.MCP_PORT]
  if (new Set(ports).size !== ports.length) {
    throw new RangeError(
      `PORT, WEBHOOK_PORT and MCP_PORT must differ (got ${ports.join(", ")})`
    )
  }
  return {
    root: ROOT,
    storeDir,
    consolePort: parsed.PORT,
    webhookPort: parsed.WEBHOOK_PORT,
    mcpPort: parsed.MCP_PORT,
    signingKey: nonEmpty(parsed.RING_HMAC_SIGNING_KEY) ?? DEMO_SIGNING_KEY,
    ledgerSecret:
      nonEmpty(parsed.VISITPROOF_LEDGER_SECRET) ?? DEMO_LEDGER_SECRET,
    until: parsed.VISITPROOF_DEMO_UNTIL,
    passthrough: dotenvPassthrough(ROOT, env),
  }
}
