import {
  constantTimeEqualBytes,
  fromHex,
  hmacSha256,
  hmacSha256Hex,
  utf8,
} from "./crypto"
import {
  WEBHOOK_SIGNATURE_PREFIX,
  webhookEnvelopeSchema,
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

/** Non-throwing parse of the raw body into the discriminated envelope. */
export const safeParseWebhook = (
  rawBody: Uint8Array | string
): ParseWebhookResult => {
  let json: unknown
  try {
    json = JSON.parse(typeof rawBody === "string" ? rawBody : decoder.decode(rawBody))
  } catch {
    return { ok: false, error: new WebhookParseError(["body is not JSON"]) }
  }
  const parsed = webhookEnvelopeSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`
    )
    return { ok: false, error: new WebhookParseError(issues) }
  }
  return { ok: true, envelope: parsed.data }
}

/** Throwing variant of `safeParseWebhook`. */
export const parseWebhook = (rawBody: Uint8Array | string): WebhookEnvelope => {
  const result = safeParseWebhook(rawBody)
  if (!result.ok) throw result.error
  return result.envelope
}

const DEVICE_LINK = /\/v1\/devices\/([^/?#]+)/

/** Device id from `attributes.source` (devices) or the relationship link. */
export const extractDeviceId = (envelope: WebhookEnvelope): string | undefined => {
  const { attributes, relationships } = envelope.data
  if (attributes.source_type === "devices") return attributes.source
  const self = relationships?.devices?.links?.self
  const match = self ? DEVICE_LINK.exec(self) : null
  return match?.[1]
}

/** Idempotency key: Ring retries with the same `meta.request_id`. */
export const dedupeKey = (envelope: WebhookEnvelope): string =>
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
