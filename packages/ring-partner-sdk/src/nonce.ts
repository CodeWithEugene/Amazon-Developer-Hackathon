import {
  constantTimeEqualStrings,
  hmacSha256,
  toBase64Url,
  utf8,
} from "./crypto"

/**
 * Account link nonce (docs/research.md Section 2.3 step 7):
 * `base64url_nopad(HMAC_SHA256(hmac_key, "{time}:{account_id}"))`.
 * Ring puts `nonce` and `time` (epoch ms) on the Account Link URL; the app
 * recomputes the nonce for every UNCLAIMED token and matches in constant time.
 */

export const DEFAULT_NONCE_WINDOW_SEC = 600

export const nonceMessage = (timeMs: number, accountId: string): string =>
  `${timeMs}:${accountId}`

export const computeAccountLinkNonce = (
  key: string,
  timeMs: number,
  accountId: string
): string => toBase64Url(hmacSha256(key, utf8(nonceMessage(timeMs, accountId))))

/**
 * A link time is fresh when it is not in the future and at most `windowSec`
 * old. `skewMs` tolerates small clock differences for the future check only.
 */
export const isFresh = (
  timeMs: number,
  nowMs: number,
  windowSec: number = DEFAULT_NONCE_WINDOW_SEC,
  skewMs = 0
): boolean => {
  if (!Number.isFinite(timeMs) || !Number.isFinite(nowMs)) return false
  if (timeMs > nowMs + skewMs) return false
  return nowMs - timeMs <= windowSec * 1000
}

/** Constant-time comparison of two nonce strings. */
export const matchNonce = (received: string, expected: string): boolean =>
  constantTimeEqualStrings(received, expected)

/**
 * Finds the account whose nonce matches. Every candidate is compared, without
 * early exit, so the timing does not reveal the matching position.
 */
export const findMatchingAccount = (
  key: string,
  receivedNonce: string,
  timeMs: number,
  accountIds: readonly string[]
): string | undefined =>
  accountIds.reduce<string | undefined>((found, accountId) => {
    const matches = matchNonce(
      receivedNonce,
      computeAccountLinkNonce(key, timeMs, accountId)
    )
    return matches && found === undefined ? accountId : found
  }, undefined)
