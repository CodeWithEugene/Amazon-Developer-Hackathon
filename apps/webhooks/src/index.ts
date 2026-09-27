import { Hono } from "hono"

import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import {
  dedupeKey,
  safeParseWebhook,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  type WebhookEnvelope,
} from "@visitproof/ring-partner-sdk"

import { systemClock, type Clock } from "./clock"
import { buildDoorEvent } from "./door-event"

/**
 * The engine hook. The server wiring (`server.ts` locally, `lambda.ts` in
 * production) injects `@visitproof/engine`'s `ingestDoorEvent` here; the
 * receiver itself codes only against the domain types.
 */
export type EngineHandler = (
  event: DoorEvent | null,
  envelope: WebhookEnvelope
) => void | Promise<void>

export interface WebhookAppOptions {
  readonly repository: VisitProofRepository
  readonly signingKey: string
  /**
   * Invoked after the event is persisted. Engine failures must not fail the
   * response: Ring would retry a webhook we already processed.
   */
  readonly onEvent?: EngineHandler
  readonly clock?: Clock
}

type WebhookRejection = { readonly status: 401 | 400; readonly error: string }
type WebhookResult = {
  readonly status: 202
  readonly body: Record<string, unknown>
}

/**
 * Builds the webhook receiver: `POST /webhooks/ring` (alias
 * `POST /ring/webhook`). Verifies the HMAC signature over the raw body
 * bytes, dedupes on `meta.request_id`, resolves the client from the Ring
 * account, persists the `DoorEvent`, then hands off to the engine.
 */
export const createApp = (options: WebhookAppOptions) => {
  const { repository, signingKey } = options
  const clock = options.clock ?? systemClock
  const onEvent = options.onEvent

  const receive = async (
    rawBody: Uint8Array,
    signature: string | undefined
  ): Promise<WebhookResult | WebhookRejection> => {
    if (!verifyWebhookSignature(rawBody, signature, signingKey)) {
      return { status: 401, error: "invalid signature" }
    }
    const parsed = safeParseWebhook(rawBody)
    if (!parsed.ok) {
      return { status: 400, error: "invalid envelope" }
    }
    const envelope = parsed.envelope

    const clientId = await repository.ringLinks.clientIdFor(
      envelope.meta.account_id
    )
    if (clientId === null) {
      return { status: 202, body: { ok: true, ignored: "unknown_account" } }
    }

    // Persist the event BEFORE claiming the receipt. If the put (or the
    // claim itself) throws, nothing is recorded and Ring's retry is
    // processed cleanly; claiming first would ack that retry as a
    // `duplicate` and lose the event permanently. The put is idempotent on
    // (clientId, timestampMs, requestId), so a retry after a mid-flight
    // failure is absorbed safely.
    const event = buildDoorEvent({ envelope, clientId, rawBody, clock })
    if (event !== null) await repository.events.put(event)

    const claimed = await repository.webhookReceipts.claim(
      dedupeKey(envelope),
      clock()
    )
    if (!claimed) return { status: 202, body: { ok: true, duplicate: true } }

    // Engine failures must never fail the webhook: the event is durable at
    // this point, and a 5xx would make Ring redeliver an event we already
    // stored. Log and still 202.
    if (onEvent !== undefined) {
      try {
        await onEvent(event, envelope)
      } catch (error) {
        console.error(
          `[webhooks] engine handler failed for ${envelope.meta.request_id}`,
          error
        )
      }
    }
    return event === null
      ? { status: 202, body: { ok: true, ignored: "unmapped_event_type" } }
      : { status: 202, body: { ok: true, requestId: event.requestId } }
  }

  const app = new Hono()

  const registerWebhookRoute = (path: string) => {
    app.post(path, async (c) => {
      const raw = new Uint8Array(await c.req.arrayBuffer())
      const result = await receive(
        raw,
        c.req.header(WEBHOOK_SIGNATURE_HEADER)
      )
      if ("error" in result) {
        return c.json({ error: result.error }, result.status)
      }
      return c.json(result.body, result.status)
    })
  }
  registerWebhookRoute("/webhooks/ring")
  registerWebhookRoute("/ring/webhook")

  app.get("/health", (c) => c.json({ ok: true, service: "webhooks" }))

  return app
}

export type WebhooksApp = ReturnType<typeof createApp>
