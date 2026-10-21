import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { createLocalRepository } from "@visitproof/db"
import { DEFAULT_TOLERANCES, agencySchema } from "@visitproof/domain"

import { createDbVisitRepository } from "./db-repo"
import { createHttpApp, type CreateHttpAppOptions } from "./index"
import { DEFAULT_AGENCY_SETTINGS, DEMO_NOW, type AgencySettings } from "./repo"

const DEFAULT_PORT = 8000
// Loopback by default; set MCP_HOST=0.0.0.0 when a deployment (AgentCore
// Runtime expects 0.0.0.0:8000/mcp) needs external reach.
const HOST = process.env.MCP_HOST ?? "127.0.0.1"
const port = Number.parseInt(process.env.MCP_PORT ?? `${DEFAULT_PORT}`, 10)

/**
 * The Agency entity is not in the repository yet; the demo seeds it as
 * `agency.json` inside the store directory (as the console reads it).
 */
const agencySettings = (storePath: string) => async (): Promise<AgencySettings> => {
  let raw: string
  try {
    raw = await readFile(join(storePath, "agency.json"), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_AGENCY_SETTINGS
    throw error
  }
  const parsed = agencySchema.partial().safeParse(JSON.parse(raw))
  if (!parsed.success) throw new Error(`${storePath}/agency.json is not a valid agency record`)
  return {
    timeZone: parsed.data.timezone ?? DEFAULT_AGENCY_SETTINGS.timeZone,
    tolerances: parsed.data.tolerances ?? DEFAULT_TOLERANCES,
  }
}

/**
 * Demo wiring: when VISITPROOF_DEMO_STORE_PATH points at the seeded local
 * store (scripts/demo.ts), the tools read and write the real store through
 * `@visitproof/db`, with a fresh repository per call so writes from the
 * console, webhooks, and demo script are always visible. Otherwise the
 * in-memory fixture world is used, with the clock frozen at the fixture's
 * "now" (2026-09-27, 12:00 PM ET) so "today" has visits.
 */
const storePath = process.env.VISITPROOF_DEMO_STORE_PATH
const options: CreateHttpAppOptions = {
  ...(storePath
    ? {
        repo: createDbVisitRepository(() => createLocalRepository(storePath), {
          agencyId: process.env.VISITPROOF_DEMO_AGENCY_ID ?? "a1",
          settings: agencySettings(storePath),
        }),
      }
    : { now: () => DEMO_NOW }),
  stateless: process.env.MCP_STATELESS === "true",
}

if ((process.env.VISITPROOF_MODE ?? "demo") === "live") {
  // Demo tokens are refused in live mode and Cognito JWT verification is not
  // implemented in this server yet, so every /mcp request gets a 401 here.
  process.stderr.write(
    "[mcp] live mode: demo tokens are disabled and no access-token verifier is configured; /mcp will answer 401 until one is added (createHttpApp verifyAccessToken)\n",
  )
}

createHttpApp(options).listen(port, HOST, () => {
  process.stdout.write(
    `mcp listening on http://${HOST}:${port}/mcp${storePath ? ` (store: ${storePath})` : ` (fixtures, clock frozen at ${DEMO_NOW.toISOString()})`}${options.stateless ? " stateless" : ""}\n`,
  )
})
