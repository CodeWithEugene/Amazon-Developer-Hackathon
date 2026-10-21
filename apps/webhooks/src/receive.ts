import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import {
  dedupeKey,
  parseWebhookLenient,
  unclaimedBucketId,
  verifyWebhookSignature,
  type LenientParseWebhookResult,
  type WebhookEnvelope,
} from "@visitproof/ring-partner-sdk"

import type { RawEventArchive } from "./archive"
import type { Clock } from "./clock"
import { buildDoorEvent, provenanceFor } from "./door-event"
import type { WebhookLogger } from "./logger"

/**
 * The receive pipeline, free of HTTP: verify the signature over the raw
 * bytes, parse leniently (a new `data.type` is archived with its raw type,
 * never 400ed), route the Ring account (linked client, UNCLAIMED bucket, or
 * a client whose integration was removed), persist, and claim the receipt.
 * Engine work is returned, not run: the caller acknowledges first (C5).
 */

export interface ReceiveContext {
  readonly repository: VisitProofRepository
  readonly signingKey: string
  readonly clock: Clock
  readonly mode: "demo" | "live"
  /** Enables the consent check (C3); without it every link is treated as active. */
  readonly agencyId?: string
  readonly archive: RawEventArchive
  readonly logger: WebhookLogger
}

export interface IncomingDelivery {
  readonly rawBody: Uint8Array
  readonly signature: string | undefined
  readonly provenanceHeader: string | undefined
}

export interface EngineWork {
  readonly event: DoorEvent | null
  readonly envelope: WebhookEnvelope
}

export type ReceiveOutcome =
  | { readonly status: 401 | 400; readonly error: string }
  | { readonly status: 202; readonly body: Record<string, unknown>; readonly engineWork?: EngineWork }

type Route =
  | { readonly kind: "linked"; readonly clientId: string }
  | { readonly kind: "unclaimed"; readonly clientId: string }
  | { readonly kind: "removed" }

const routeAccount = async (ctx: ReceiveContext, accountId: string): Promise<Route> => {
  const clientId = await ctx.repository.ringLinks.clientIdFor(accountId)
  if (clientId === null) return { kind: "unclaimed", clientId: unclaimedBucketId(accountId) }
  if (ctx.agencyId === undefined) return { kind: "linked", clientId }
  const client = await ctx.repository.clients.get(ctx.agencyId, clientId)
  return client?.ringLinkStatus === "removed" ? { kind: "removed" } : { kind: "linked", clientId }
}

const persistKnown = async (
  ctx: ReceiveContext,
  delivery: IncomingDelivery,
  envelope: WebhookEnvelope,
  route: Extract<Route, { clientId: string }>
): Promise<ReceiveOutcome> => {
  // Persist BEFORE claiming the receipt: if the put (or the claim) throws,
  // nothing is recorded and Ring's retry is processed cleanly. The put is
  // idempotent on (clientId, timestampMs, requestId).
  const event = buildDoorEvent({
    envelope,
    clientId: route.clientId,
    rawBody: delivery.rawBody,
    clock: ctx.clock,
    provenance: provenanceFor(ctx.mode, delivery.provenanceHeader),
  })
  if (event !== null) await ctx.repository.events.put(event)
  const claimed = await ctx.repository.webhookReceipts.claim(dedupeKey(envelope), ctx.clock())
  if (!claimed) return { status: 202, body: { ok: true, duplicate: true } }
  const unclaimed = route.kind === "unclaimed" ? { unclaimed: true } : {}
  const body =
    event === null
      ? { ok: true, ignored: "unmapped_event_type", ...unclaimed }
      : { ok: true, requestId: event.requestId, ...unclaimed }
  // Unclaimed events have no client yet; the engine runs once the link exists.
  return route.kind === "linked" ? { status: 202, body, engineWork: { event, envelope } } : { status: 202, body }
}

const persistUnknown = async (
  ctx: ReceiveContext,
  delivery: IncomingDelivery,
  parsed: Extract<LenientParseWebhookResult, { kind: "unknown" }>
): Promise<ReceiveOutcome> => {
  const requestId = dedupeKey(parsed.envelope)
  ctx.logger.warn("unknown Ring event type stored raw", {
    requestId,
    rawType: parsed.rawType,
    issues: parsed.issues.slice(0, 5),
  })
  await ctx.archive.put({
    requestId,
    accountId: parsed.envelope.meta.account_id,
    rawType: parsed.rawType,
    receivedAt: ctx.clock().toISOString(),
    rawBody: new TextDecoder().decode(delivery.rawBody),
  })
  const claimed = await ctx.repository.webhookReceipts.claim(requestId, ctx.clock())
  if (!claimed) return { status: 202, body: { ok: true, duplicate: true } }
  return { status: 202, body: { ok: true, requestId, stored: "raw", rawType: parsed.rawType } }
}

export const receiveDelivery = async (
  ctx: ReceiveContext,
  delivery: IncomingDelivery
): Promise<ReceiveOutcome> => {
  if (!verifyWebhookSignature(delivery.rawBody, delivery.signature, ctx.signingKey)) {
    return { status: 401, error: "invalid signature" }
  }
  const parsed = parseWebhookLenient(delivery.rawBody)
  if (!parsed.ok) return { status: 400, error: "invalid envelope" }
  const route = await routeAccount(ctx, parsed.envelope.meta.account_id)
  // Contract C3: a removed integration is acknowledged, never stored.
  if (route.kind === "removed") return { status: 202, body: { ok: true, ignored: "integration_removed" } }
  if (parsed.kind === "unknown") return persistUnknown(ctx, delivery, parsed)
  return persistKnown(ctx, delivery, parsed.envelope, route)
}
