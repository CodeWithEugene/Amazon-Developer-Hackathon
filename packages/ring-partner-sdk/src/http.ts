import { errorForStatus, parseErrorDocument, RingNetworkError } from "./errors"
import { HEADERS } from "./endpoints"

/**
 * Rate-limit aware fetch wrapper. Ring allows 100 requests per second per
 * client_id; on 429 or 503 the wrapper honors `Retry-After` when present and
 * otherwise backs off exponentially from 1 s, for at most 3 retries.
 */

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>

export type SleepFn = (ms: number) => Promise<void>

export interface RateLimitInfo {
  readonly status: number
  readonly attempt: number
  readonly waitMs: number
  readonly url: string
}

export interface RetryOptions {
  readonly fetch?: FetchLike
  readonly sleep?: SleepFn
  readonly maxRetries?: number
  readonly baseBackoffMs?: number
  readonly maxBackoffMs?: number
  readonly onRateLimit?: (info: RateLimitInfo) => void
  readonly now?: () => number
}

export const DEFAULT_MAX_RETRIES = 3
export const DEFAULT_BASE_BACKOFF_MS = 1_000
export const DEFAULT_MAX_BACKOFF_MS = 60_000
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503])

export const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const resolveFetch = (candidate?: FetchLike): FetchLike => {
  if (candidate) return candidate
  if (typeof globalThis.fetch !== "function") {
    throw new RingNetworkError(
      { status: 0, method: "GET", url: "" },
      "No fetch implementation available; pass one in options"
    )
  }
  return (input, init) => globalThis.fetch(input, init)
}

/** Parses `Retry-After` as delay seconds or as an HTTP date. */
export const parseRetryAfterMs = (
  header: string | null,
  nowMs: number
): number | undefined => {
  if (!header) return undefined
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - nowMs)
}

export const computeBackoffMs = (
  attempt: number,
  baseMs: number = DEFAULT_BASE_BACKOFF_MS,
  maxMs: number = DEFAULT_MAX_BACKOFF_MS
): number => Math.min(maxMs, baseMs * 2 ** attempt)

const waitFor = (
  response: Response,
  attempt: number,
  options: RetryOptions
): number => {
  const now = options.now ?? Date.now
  const fromHeader = parseRetryAfterMs(response.headers.get(HEADERS.retryAfter), now())
  const backoff = computeBackoffMs(attempt, options.baseBackoffMs, options.maxBackoffMs)
  return Math.min(fromHeader ?? backoff, options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)
}

/**
 * Performs the request, retrying 429 and 503 responses. Other statuses are
 * returned untouched so callers can map them; network failures become
 * `RingNetworkError`.
 */
export const requestWithRetry = async (
  url: string,
  init: RequestInit,
  options: RetryOptions = {}
): Promise<Response> => {
  const fetch = resolveFetch(options.fetch)
  const sleep = options.sleep ?? defaultSleep
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const method = init.method ?? "GET"
  const attemptOnce = async (attempt: number): Promise<Response> => {
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (cause) {
      throw new RingNetworkError({ status: 0, method, url, cause })
    }
    if (!RETRYABLE_STATUSES.has(response.status) || attempt >= maxRetries) {
      return response
    }
    const waitMs = waitFor(response, attempt, options)
    options.onRateLimit?.({ status: response.status, attempt: attempt + 1, waitMs, url })
    await sleep(waitMs)
    return attemptOnce(attempt + 1)
  }
  return attemptOnce(0)
}

const readJsonBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text }
  }
}

/** Converts a non-2xx response into the typed error, consuming the body. */
export const throwForResponse = async (
  response: Response,
  method: string,
  url: string,
  nowMs: number = Date.now()
): Promise<never> => {
  const body = await readJsonBody(response)
  throw errorForStatus({
    status: response.status,
    method,
    url,
    document: parseErrorDocument(body),
    retryAfterMs: parseRetryAfterMs(response.headers.get(HEADERS.retryAfter), nowMs),
  })
}
