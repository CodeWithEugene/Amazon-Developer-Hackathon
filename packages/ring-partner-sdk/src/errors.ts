import { errorDocumentSchema, type ErrorDocument } from "./types"

/**
 * Typed errors for the Ring Partner API. Every non-2xx response the client
 * cannot recover from becomes one of these; media status codes documented in
 * docs/research.md Section 2.2 get dedicated subclasses so callers can branch
 * with `instanceof` instead of comparing numbers.
 */

export interface RingApiErrorInit {
  readonly status: number
  readonly method: string
  readonly url: string
  readonly document?: ErrorDocument
  readonly retryAfterMs?: number
  readonly cause?: unknown
}

export class RingApiError extends Error {
  readonly status: number
  readonly method: string
  readonly url: string
  readonly document: ErrorDocument | undefined
  readonly retryAfterMs: number | undefined

  constructor(message: string, init: RingApiErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause })
    this.name = "RingApiError"
    this.status = init.status
    this.method = init.method
    this.url = init.url
    this.document = init.document
    this.retryAfterMs = init.retryAfterMs
  }

  /** First error code from the JSON:API error document, when present. */
  get code(): string | undefined {
    return this.document?.errors[0]?.code
  }
}

const subclass = (name: string, defaultMessage: string) =>
  class extends RingApiError {
    constructor(init: RingApiErrorInit, message = defaultMessage) {
      super(message, init)
      this.name = name
    }
  }

/** 401: token missing, expired, or revoked. */
export class RingUnauthorizedError extends subclass(
  "RingUnauthorizedError",
  "Ring rejected the access token"
) {}
/** 403 TIME_RANGE_NOT_AUTHORIZED: media requested before the consent time. */
export class RingTimeRangeNotAuthorizedError extends subclass(
  "RingTimeRangeNotAuthorizedError",
  "Requested time range is before the consent time"
) {}
/** 404: device or resource not shared with this app. */
export class RingNotFoundError extends subclass(
  "RingNotFoundError",
  "Ring resource not found"
) {}
/** 416 MEDIA_NOT_FOUND: nothing recorded in the requested range. */
export class RingMediaNotFoundError extends subclass(
  "RingMediaNotFoundError",
  "No media exists for the requested range"
) {}
/** 422: request body rejected. */
export class RingUnprocessableError extends subclass(
  "RingUnprocessableError",
  "Ring rejected the request body"
) {}
/** 425 RECORDING_NOT_READY: the recording is still being processed. */
export class RingRecordingNotReadyError extends subclass(
  "RingRecordingNotReadyError",
  "Recording is not ready yet; retry shortly"
) {}
/** 429: per client_id rate limit exhausted after retries. */
export class RingRateLimitError extends subclass(
  "RingRateLimitError",
  "Ring rate limit exceeded"
) {}
/** 503: Ring unavailable after retries. */
export class RingServiceUnavailableError extends subclass(
  "RingServiceUnavailableError",
  "Ring service unavailable"
) {}
/** Network failure or a response that could not be read. */
export class RingNetworkError extends subclass(
  "RingNetworkError",
  "Network error while calling Ring"
) {}
/** A 2xx response whose body did not match the expected schema. */
export class RingSchemaError extends subclass(
  "RingSchemaError",
  "Ring response did not match the expected schema"
) {}

const ERRORS_BY_STATUS: Readonly<
  Record<number, new (init: RingApiErrorInit) => RingApiError>
> = {
  401: RingUnauthorizedError,
  403: RingTimeRangeNotAuthorizedError,
  404: RingNotFoundError,
  416: RingMediaNotFoundError,
  422: RingUnprocessableError,
  425: RingRecordingNotReadyError,
  429: RingRateLimitError,
  503: RingServiceUnavailableError,
}

export const parseErrorDocument = (body: unknown): ErrorDocument | undefined => {
  const result = errorDocumentSchema.safeParse(body)
  return result.success ? result.data : undefined
}

/** Maps a status code (plus optional error document) to the typed error. */
export const errorForStatus = (init: RingApiErrorInit): RingApiError => {
  const Ctor = ERRORS_BY_STATUS[init.status]
  if (Ctor) return new Ctor(init)
  const detail = init.document?.errors[0]?.detail
  return new RingApiError(
    detail ?? `Ring responded with HTTP ${init.status}`,
    init
  )
}
