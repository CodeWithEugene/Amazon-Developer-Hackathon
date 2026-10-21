import { join } from "node:path"

import { createLocalRepository } from "@visitproof/db"
import { createLocalHmacLedgerSigner, repositoryLedger } from "@visitproof/engine"
import { serve } from "@hono/node-server"

import { createFileArchive } from "./archive"
import { readReceiverConfig } from "./config"
import { createEngineHook } from "./engine-hook"
import { createApp } from "./index"

/**
 * Local dev server: the receiver over the on-disk demo store, so the
 * emulator can deliver signed webhooks with zero AWS credentials. With
 * VISITPROOF_ENGINE_INLINE unset or "true", persisted events are ingested by
 * the real Presence Engine after the 202; the demo sets it to "false" and
 * replays the engine in simulated time instead.
 */
const DEFAULT_PORT = 3101
const DEFAULT_STORE_DIR = ".visitproof/demo-store"
/** Matches apps/console/lib/store/ledger.ts so one local chain verifies everywhere. */
const DEMO_LEDGER_SECRET = "visitproof-local-demo-ledger"

const config = readReceiverConfig(process.env)
const port = config.port ?? DEFAULT_PORT
const storeDir = process.env.VISITPROOF_DEMO_STORE_PATH ?? DEFAULT_STORE_DIR
const agencyId = process.env.VISITPROOF_DEMO_AGENCY_ID ?? "a1"

const repository = createLocalRepository(storeDir)
const app = createApp({
  repository,
  signingKey: config.signingKey,
  mode: config.mode,
  engineInline: config.engineInline,
  agencyId,
  archive: createFileArchive(join(storeDir, "webhook-inbox")),
  ...(config.engineInline
    ? {
        onEvent: createEngineHook(repository, agencyId, {
          // Local HMAC stand-in for the KMS signer (demo and local dev only).
          ledger: repositoryLedger(
            repository,
            createLocalHmacLedgerSigner({
              secret: process.env.VISITPROOF_LEDGER_SECRET ?? DEMO_LEDGER_SECRET,
            })
          ),
        }),
      }
    : {}),
})

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(
    `webhooks listening on http://localhost:${info.port} (store: ${storeDir}, mode: ${config.mode}, engine inline: ${config.engineInline})\n`
  )
})
