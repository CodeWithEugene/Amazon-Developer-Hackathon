import {
  constantTimeEqualBytes,
  fromHex,
  hmacSha256,
  hmacSha256Hex,
  utf8,
} from "./crypto"
import {
  rawWebhookEnvelopeSchema,
  WEBHOOK_SIGNATURE_PREFIX,
  webhookEnvelopeSchema,
  type RawWebhookEnvelope,
  type WebhookEnvelope,
} from "./types"

/**
 * Webhook verification and parsing (docs/research.md Section 2.2).
 * Signature: `X-Signature: sha256=<hex HMAC-SHA256 over the raw body bytes>`.
 * Always verify over the exact bytes received, never over re-serialized JSON.
 */

const decoder = new TextDecoder()

const toBytes = (body: Uint8Array | string): Uint8Array =>
  typeof body === "string" ? utf8(body) : body

/** Produces the header value the emulator (or a test) attaches to a body. */
export const signWebhookBody = (rawBody: Uint8Array | string, key: string) =>
  `${WEBHOOK_SIGNATURE_PREFIX}${hmacSha256Hex(key, toBytes(rawBody))}`

/**
 * Constant-time verification. Returns false for a missing or malformed
 * header, a wrong key, or a tampered body; never throws.
 */
export const verifyWebhookSignature = (
  rawBody: Uint8Array,
  header: string | null | undefined,
  key: string
): boolean => {
  if (!header || key.length === 0) return false
  const trimmed = header.trim()
  if (!trimmed.toLowerCase().startsWith(WEBHOOK_SIGNATURE_PREFIX)) return false
  const provided = fromHex(trimmed.slice(WEBHOOK_SIGNATURE_PREFIX.length))
  if (!provided) return false
  return constantTimeEqualBytes(provided, hmacSha256(key, rawBody))
}

export class WebhookParseError extends Error {
  readonly issues: readonly string[]
  constructor(issues: readonly string[]) {
    super(`Webhook body did not match the v1.1 envelope: ${issues.join("; ")}`)
    this.name = "WebhookParseError"
    this.issues = issues
  }
}

export type ParseWebhookResult =
  | { readonly ok: true; readonly envelope: WebhookEnvelope }
  | { readonly ok: false; readonly error: WebhookParseError }

const decodeJson = (rawBody: Uint8Array | string): { ok: true; json: unknown } | { ok: false } => {
  try {
    return { ok: true, json: JSON.parse(typeof rawBody === "string" ? rawBody : decoder.decode(rawBody)) }
  } catch {
    return { ok: false }
  }
}

const issuesOf = (error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }) =>
  error.issues.map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`)

/** Non-throwing parse of the raw body into the discriminated envelope. */
export const safeParseWebhook = (
  rawBody: Uint8Array | string
): ParseWebhookResult => {
  const decoded = decodeJson(rawBody)
  if (!decoded.ok) return { ok: false, error: new WebhookParseError(["body is not JSON"]) }
  const parsed = webhookEnvelopeSchema.safeParse(decoded.json)
  if (!parsed.success) return { ok: false, error: new WebhookParseError(issuesOf(parsed.error)) }
  return { ok: true, envelope: parsed.data }
}

export type LenientParseWebhookResult =
  | { readonly ok: true; readonly kind: "known"; readonly envelope: WebhookEnvelope }
  | {
      readonly ok: true
      readonly kind: "unknown"
      readonly envelope: RawWebhookEnvelope
      /** The raw `data.type`, stored so the event can be reprocessed later. */
      readonly rawType: string
      /** Why the strict schema rejected it (for logs). */
      readonly issues: readonly string[]
    }
  | { readonly ok: false; readonly error: WebhookParseError }

/**
 * Receiver-grade parse for a body whose signature already verified: known
 * event families parse strictly; anything else with a usable `meta`
 * (request and account ids) and a `data.type` comes back as `kind: "unknown"`
 * with the raw type, so the receiver can log and store it and still ack.
 * Only bodies that are not JSON or carry no ids fail.
 */
export const parseWebhookLenient = (
  rawBody: Uint8Array | string
): LenientParseWebhookResult => {
  const decoded = decodeJson(rawBody)
  if (!decoded.ok) return { ok: false, error: new WebhookParseError(["body is not JSON"]) }
  const strict = webhookEnvelopeSchema.safeParse(decoded.json)
  if (strict.success) return { ok: true, kind: "known", envelope: strict.data }
  const raw = rawWebhookEnvelopeSchema.safeParse(decoded.json)
  if (!raw.success) return { ok: false, error: new WebhookParseError(issuesOf(raw.error)) }
  return {
    ok: true,
    kind: "unknown",
    envelope: raw.data,
    rawType: raw.data.data.type,
    issues: issuesOf(strict.error),
  }
}

/** Throwing variant of `safeParseWebhook`. */
export const parseWebhook = (rawBody: Uint8Array | string): WebhookEnvelope => {
  const result = safeParseWebhook(rawBody)
  if (!result.ok) throw result.error
  return result.envelope
}

const DEVICE_LINK = /\/v1\/devices\/([^/?#]+)/

/** Device id from `attributes.source` (devices) or the relationship link. */
export const extractDeviceId = (
  envelope: WebhookEnvelope | RawWebhookEnvelope
): string | undefined => {
  const { attributes, relationships } = envelope.data
  if (attributes?.source_type === "devices" && attributes.source) return attributes.source
  const self = relationships?.devices?.links?.self
  const match = self ? DEVICE_LINK.exec(self) : null
  return match?.[1]
}

/** Idempotency key: Ring retries with the same `meta.request_id`. */
export const dedupeKey = (envelope: WebhookEnvelope | RawWebhookEnvelope): string =>
  envelope.meta.request_id

export interface ReplayGuard {
  /** Returns true when the key was already seen (a replay), false otherwise. */
  readonly seen: (key: string) => boolean
  readonly size: () => number
}

/**
 * In-memory replay guard. Deliberately exported SDK surface (this package is
 * publishable): consumers building their own lightweight receiver or tests
 * dedupe with it, while the in-repo receivers dedupe durably through the
 * repository's `webhookReceipts.claim` conditional put instead.
 */
export const createReplayGuard = (maxEntries = 10_000): ReplayGuard => {
  const keys = new Set<string>()
  return {
    seen: (key) => {
      if (keys.has(key)) return true
      if (keys.size >= maxEntries) {
        const oldest = keys.values().next().value
        if (oldest !== undefined) keys.delete(oldest)
      }
      keys.add(key)
      return false
    },
    size: () => keys.size,
  }
}
