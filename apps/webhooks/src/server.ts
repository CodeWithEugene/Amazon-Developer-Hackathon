import { createLocalRepository } from "@visitproof/db"
import { serve } from "@hono/node-server"

import { createEngineHook } from "./engine-hook"
import { createApp } from "./index"

/**
 * Local dev server: the receiver over the on-disk demo store, so the
 * emulator can deliver signed webhooks with zero AWS credentials. Persisted
 * events are ingested by the real Presence Engine against the same store.
 */
const DEFAULT_PORT = 3101
const DEFAULT_STORE_DIR = ".visitproof/demo-store"

const port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10)
const storeDir = process.env.VISITPROOF_DEMO_STORE_PATH ?? DEFAULT_STORE_DIR
const signingKey = process.env.RING_HMAC_SIGNING_KEY ?? ""
const agencyId = process.env.VISITPROOF_DEMO_AGENCY_ID ?? "a1"

const repository = createLocalRepository(storeDir)
const onEvent = createEngineHook(repository, agencyId)

serve(
  { fetch: createApp({ repository, signingKey, onEvent }).fetch, port },
  (info) => {
    process.stdout.write(
      `webhooks listening on http://localhost:${info.port} (store: ${storeDir})\n`
    )
  }
)
