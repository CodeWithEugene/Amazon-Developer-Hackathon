import {
  RingApiError,
  RingNetworkError,
  RingNotFoundError,
  RingServiceUnavailableError,
  RingUnauthorizedError,
} from "@visitproof/ring-partner-sdk"

/**
 * Typed live-mode errors with safe, plain-language messages. Routes map
 * them to HTTP status codes; pages render them in an Alert.
 */

export type RingLiveErrorCode =
  | "live_mode_off"
  | "token_expired"
  | "not_linked"
  | "misconfigured"
  | "device_unavailable"
  | "device_not_found"
  | "ring_error"

const STATUS: Readonly<Record<RingLiveErrorCode, number>> = {
  live_mode_off: 503,
  token_expired: 401,
  not_linked: 409,
  misconfigured: 503,
  device_unavailable: 503,
  device_not_found: 404,
  ring_error: 502,
}

export class RingLiveError extends Error {
  readonly code: RingLiveErrorCode
  readonly status: number

  constructor(code: RingLiveErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "RingLiveError"
    this.code = code
    this.status = STATUS[code]
  }
}

export const liveModeOff = (): RingLiveError =>
  new RingLiveError(
    "live_mode_off",
    "Live mode is off. Set RING_PLAYGROUND_ACCESS_TOKEN on the server or link a Ring account to call the Ring Partner API."
  )

export const tokenExpired = (source: "playground" | "linked", cause?: unknown): RingLiveError =>
  new RingLiveError(
    "token_expired",
    source === "playground"
      ? "The Ring Playground token was rejected. Playground tokens last about 30 minutes; mint a new one and restart the console."
      : "Ring rejected the linked account's token. Link the Ring account again from the Ring app.",
    { cause }
  )

/** Maps SDK and unknown errors to a `RingLiveError` (never leaks internals). */
export const toRingLiveError = (error: unknown, source: "playground" | "linked" = "playground"): RingLiveError => {
  if (error instanceof RingLiveError) return error
  if (error instanceof RingUnauthorizedError) return tokenExpired(source, error)
  if (error instanceof RingServiceUnavailableError) {
    return new RingLiveError(
      "device_unavailable",
      "Ring could not reach the device right now. It may be offline or asleep. Try again in a minute.",
      { cause: error }
    )
  }
  if (error instanceof RingNotFoundError) {
    return new RingLiveError("device_not_found", "That device is not shared with VisitProof.", { cause: error })
  }
  if (error instanceof RingNetworkError) {
    return new RingLiveError("ring_error", "VisitProof could not reach Ring. Check the network and try again.", { cause: error })
  }
  if (error instanceof RingApiError) {
    return new RingLiveError("ring_error", `Ring answered with HTTP ${error.status}. Try again shortly.`, { cause: error })
  }
  return new RingLiveError("ring_error", "Something went wrong while calling Ring. Try again.", { cause: error })
}
