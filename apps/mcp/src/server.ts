import { createLocalRepository } from "@visitproof/db"

import { createDbVisitRepository } from "./db-repo"
import { createHttpApp, type CreateHttpAppOptions } from "./index"

const DEFAULT_PORT = 8000
// Demo mode binds loopback only; set MCP_HOST=0.0.0.0 explicitly when a
// deployment (e.g. an AgentCore sidecar) needs external reach.
const HOST = process.env.MCP_HOST ?? "127.0.0.1"

const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10)

/**
 * Demo wiring: when VISITPROOF_DEMO_STORE_PATH points at the seeded local
 * store (scripts/demo.ts), the tools read real seeded state through
 * `@visitproof/db`; otherwise the in-memory fixture repo is used.
 */
const storePath = process.env.VISITPROOF_DEMO_STORE_PATH
const options: CreateHttpAppOptions = storePath
  ? {
      repo: createDbVisitRepository(createLocalRepository(storePath), {
        agencyId: process.env.VISITPROOF_DEMO_AGENCY_ID ?? "a1",
      }),
    }
  : {}

createHttpApp(options).listen(port, HOST, () => {
  process.stdout.write(
    `mcp listening on http://${HOST}:${port}${storePath ? ` (store: ${storePath})` : " (fixtures)"}\n`,
  )
})
