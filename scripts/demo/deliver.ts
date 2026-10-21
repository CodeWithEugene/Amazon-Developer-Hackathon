/**
 * Delivers the emulator's signed webhooks over real HTTP to the webhook
 * receiver (apps/webhooks). The receiver runs with
 * VISITPROOF_ENGINE_INLINE=false: it verifies, dedupes, persists, and
 * acknowledges, and the engine is replayed later in simulated time. A few
 * deliveries are sent twice, as Ring's at-least-once delivery does, so the
 * dedupe shows in the log.
 */
import {
  withRedeliveries,
  type WebhookDelivery,
} from "@visitproof/ring-partner-sdk"

import type { DemoConfig } from "./config"
import { AGENCY_ID } from "./config"
import { DemoError, log } from "./log"
import { serviceNamed, startService, waitForService } from "./processes"

const HEALTH_TIMEOUT_MS = 60_000

export interface DeliveryCounts {
  readonly signed: number
  readonly sent: number
  readonly accepted: number
  readonly duplicates: number
}

export async function startWebhooks(config: DemoConfig): Promise<void> {
  const service = startService(
    "webhooks",
    ["--filter", "@visitproof/webhooks", "exec", "tsx", "src/server.ts"],
    {
      PORT: String(config.webhookPort),
      VISITPROOF_MODE: "demo",
      VISITPROOF_ENGINE_INLINE: "false",
      VISITPROOF_DEMO_STORE_PATH: config.storeDir,
      VISITPROOF_DEMO_AGENCY_ID: AGENCY_ID,
      RING_HMAC_SIGNING_KEY: config.signingKey,
    },
    config.root
  )
  await waitForService(
    service,
    `http://localhost:${config.webhookPort}/health`,
    serviceNamed("webhooks"),
    HEALTH_TIMEOUT_MS
  )
}

async function post(port: number, delivery: WebhookDelivery): Promise<boolean> {
  const response = await fetch(`http://localhost:${port}/webhooks/ring`, {
    method: "POST",
    headers: delivery.headers,
    // The exact signed bytes; the cast only satisfies the DOM BodyInit typing.
    body: delivery.rawBody as unknown as BodyInit,
  })
  if (response.status !== 202) {
    throw new DemoError(
      `the receiver rejected a delivery with ${response.status}: ${await response.text()}`
    )
  }
  const body = (await response.json()) as {
    duplicate?: boolean
    ignored?: string
    unclaimed?: boolean
  }
  if (body.ignored)
    throw new DemoError(`the receiver ignored a delivery (${body.ignored})`)
  if (body.unclaimed)
    throw new DemoError(
      "a delivery arrived for a Ring account that is not linked"
    )
  return body.duplicate === true
}

export async function deliverAll(
  config: DemoConfig,
  deliveries: readonly WebhookDelivery[]
): Promise<DeliveryCounts> {
  const wire = withRedeliveries(deliveries)
  log(
    "webhooks",
    `posting ${deliveries.length} signed deliveries (${wire.length - deliveries.length} sent twice)`
  )
  let duplicates = 0
  for (const delivery of wire) {
    if (await post(config.webhookPort, delivery)) duplicates += 1
  }
  const counts = {
    signed: deliveries.length,
    sent: wire.length,
    accepted: wire.length - duplicates,
    duplicates,
  }
  log(
    "webhooks",
    `${counts.accepted} accepted, ${counts.duplicates} duplicates absorbed, 0 signature failures`
  )
  return counts
}
