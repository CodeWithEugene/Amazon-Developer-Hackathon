import { Hono } from "hono"

import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import {
  PROVENANCE_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEnvelope,
} from "@visitproof/ring-partner-sdk"

import { createMemoryArchive, type RawEventArchive } from "./archive"
import { systemClock, type Clock } from "./clock"
import { errorMeta, stderrLogger, type WebhookLogger } from "./logger"
import { receiveDelivery, type EngineWork, type ReceiveContext } from "./receive"

/**
 * The engine hook. The server wiring (`server.ts` locally, `lambda.ts` in
 * production) injects `@visitproof/engine`'s `ingestDoorEvent` here; the
 * receiver itself codes only against the domain types.
 */
export type EngineHandler = (
  event: DoorEvent | null,
  envelope: WebhookEnvelope
) => void | Promise<void>

/** Schedules engine work after the response is sent. */
export type DeferFn = (task: () => Promise<void>) => void

export interface WebhookAppOptions {
  readonly repository: VisitProofRepository
  readonly signingKey: string
  /**
   * Invoked after the 202 is sent (contract C5). Engine failures never fail
   * the response: Ring would retry a webhook we already processed.
   */
  readonly onEvent?: EngineHandler
  readonly clock?: Clock
  /** VISITPROOF_MODE; the emulated provenance header is honored only in demo (C4). Default "live". */
  readonly mode?: "demo" | "live"
  /** VISITPROOF_ENGINE_INLINE; false skips engine work entirely. Default true. */
  readonly engineInline?: boolean
  /** Agency whose client consent is enforced (C3). */
  readonly agencyId?: string
  readonly archive?: RawEventArchive
  readonly logger?: WebhookLogger
  /** Defaults to `setImmediate`, so the ack never waits for the engine. */
  readonly defer?: DeferFn
}

const defaultDefer: DeferFn = (task) => {
  setImmediate(() => {
    void task()
  })
}

const scheduleEngine = (options: WebhookAppOptions, logger: WebhookLogger, work: EngineWork): void => {
  const { onEvent } = options
  if (onEvent === undefined || options.engineInline === false) return
  ;(options.defer ?? defaultDefer)(async () => {
    try {
      await onEvent(work.event, work.envelope)
    } catch (error) {
      logger.error("engine handler failed", { requestId: work.envelope.meta.request_id, ...errorMeta(error) })
    }
  })
}

/**
 * Builds the webhook receiver: `POST /webhooks/ring` (alias
 * `POST /ring/webhook`). Verifies the HMAC signature over the raw body
 * bytes, dedupes on `meta.request_id`, resolves the client from the Ring
 * account, persists, acknowledges with 202, and only then hands off to the
 * engine.
 */
export const createApp = (options: WebhookAppOptions) => {
  const logger = options.logger ?? stderrLogger
  const ctx: ReceiveContext = {
    repository: options.repository,
    signingKey: options.signingKey,
    clock: options.clock ?? systemClock,
    mode: options.mode ?? "live",
    archive: options.archive ?? createMemoryArchive(),
    logger,
    ...(options.agencyId === undefined ? {} : { agencyId: options.agencyId }),
  }
  const app = new Hono()

  const registerWebhookRoute = (path: string) => {
    app.post(path, async (c) => {
      const outcome = await receiveDelivery(ctx, {
        rawBody: new Uint8Array(await c.req.arrayBuffer()),
        signature: c.req.header(WEBHOOK_SIGNATURE_HEADER),
        provenanceHeader: c.req.header(PROVENANCE_HEADER),
      })
      if ("error" in outcome) return c.json({ error: outcome.error }, outcome.status)
      if (outcome.engineWork) scheduleEngine(options, logger, outcome.engineWork)
      return c.json(outcome.body, outcome.status)
    })
  }
  registerWebhookRoute("/webhooks/ring")
  registerWebhookRoute("/ring/webhook")

  app.get("/health", (c) => c.json({ ok: true, service: "webhooks" }))

  return app
}

export type WebhooksApp = ReturnType<typeof createApp>
export { readReceiverConfig, type ReceiverConfig } from "./config"
export { createFileArchive, createMemoryArchive, type RawEventArchive, type RawEventRecord } from "./archive"
