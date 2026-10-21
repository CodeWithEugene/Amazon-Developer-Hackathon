import { ENDPOINTS, HEADERS } from "./endpoints"
import { parseErrorDocument, RingSchemaError } from "./errors"
import type { HistoryQuery } from "./types"

/** Pure helpers for `RingClient`: URL building, header reads, parsing. */

export type SafeParser<T> = {
  safeParse: (input: unknown) => { success: true; data: T } | { success: false }
}

export const parseOrThrow = <T>(
  schema: SafeParser<T>,
  label: string,
  body: unknown,
  url: string,
  method = "GET"
): T => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new RingSchemaError(
      { status: 200, method, url, document: parseErrorDocument(body) },
      `${label} response did not match the expected schema`
    )
  }
  return parsed.data
}

/** Reads a JSON body, or `undefined` when the body is empty (204 and friends). */
export const readJsonOrEmpty = async (response: Response): Promise<unknown> => {
  const text = await response.text()
  return text.length === 0 ? undefined : (JSON.parse(text) as unknown)
}

export const numberHeader = (headers: Headers, name: string): number | undefined => {
  const value = headers.get(name)
  if (value === null || !/^\d+$/.test(value)) return undefined
  return Number(value)
}

/** First non-null value of a header across responses (redirect first). */
export const firstHeader = (name: string, ...responses: readonly Response[]): string | null => {
  for (const response of responses) {
    const value = response.headers.get(name)
    if (value !== null) return value
  }
  return null
}

export const resolveUrl = (baseUrl: string, pathOrUrl: string): string =>
  /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`

/** A `links.next` value is a URL or an absolute path; anything else is a cursor. */
export const isLinkCursor = (pageKey: string): boolean =>
  /^https?:\/\//i.test(pageKey) || pageKey.startsWith("/")

/**
 * The history page to fetch. `links.next` is followed verbatim; an opaque
 * `meta.page_key` is sent as `page_key` on the device's history path, so the
 * device path and the other query parameters are never lost.
 */
export const historyPagePath = (deviceId: string, query: HistoryQuery): string => {
  if (query.pageKey && isLinkCursor(query.pageKey)) return query.pageKey
  const params: string[] = []
  if (query.pageKey) params.push(`page_key=${encodeURIComponent(query.pageKey)}`)
  if (query.eventTypes?.length) {
    params.push(`event_types=${query.eventTypes.map((type) => encodeURIComponent(type)).join(",")}`)
  }
  if (query.limit) params.push(`limit=${query.limit}`)
  const base = ENDPOINTS.historyEvents(deviceId)
  return params.length ? `${base}?${params.join("&")}` : base
}

export interface MediaHeaders {
  readonly origin: string | undefined
  readonly encrypted: boolean | undefined
  readonly length: number | undefined
}

/** Media metadata lives on Ring's 303; the presigned response is a fallback. */
export const mediaHeaders = (redirect: Response, media: Response): MediaHeaders => {
  const encrypted = firstHeader(HEADERS.mediaEncrypted, redirect, media)
  const lengthSource = redirect.headers.has(HEADERS.mediaLength) ? redirect : media
  return {
    origin: firstHeader(HEADERS.mediaOrigin, redirect, media) ?? undefined,
    encrypted: encrypted === null ? undefined : encrypted.toLowerCase() === "true",
    length: numberHeader(lengthSource.headers, HEADERS.mediaLength),
  }
}

const IDEMPOTENT_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "DELETE", "OPTIONS"])

export const isIdempotent = (method: string | undefined): boolean =>
  IDEMPOTENT_METHODS.has((method ?? "GET").toUpperCase())
