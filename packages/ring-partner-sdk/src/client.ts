import { CONTENT_TYPES, DEFAULT_RING_API_BASE, ENDPOINTS, HEADERS } from "./endpoints"
import {
  requestWithRetry,
  resolveFetch,
  throwForResponse,
  type FetchLike,
  type RateLimitInfo,
  type RetryOptions,
  type SleepFn,
  defaultSleep,
} from "./http"
import {
  appIntegrationDocumentSchema,
  deviceCapabilitiesDocumentSchema,
  deviceConfigurationsDocumentSchema,
  deviceDocumentSchema,
  deviceListDocumentSchema,
  deviceLocationDocumentSchema,
  deviceStatusDocumentSchema,
  historyDocumentSchema,
  subscriptionListDocumentSchema,
  userDocumentSchema,
  whepStartResponseSchema,
  type AppIntegrationConfirmRequest,
  type AppIntegrationDocument,
  type ClipRequest,
  type DeviceInclude,
  type HistoryDocument,
  type HistoryEvent,
  type HistoryQuery,
  type SubscriptionListDocument,
  type UserDocument,
} from "./types"
import {
  historyPagePath,
  isIdempotent,
  mediaHeaders,
  parseOrThrow,
  readJsonOrEmpty,
  resolveUrl,
  type SafeParser,
} from "./client-support"
import { snapshotRequestSchema, type SnapshotRequestInput } from "./media"
import { RingNotAvailableForAccountError, RingUnprocessableError } from "./errors"

/**
 * Typed client for the Ring Partner API. Every method validates the response
 * against its Zod schema (`RingSchemaError` on mismatch) and maps non-2xx
 * statuses to the typed error hierarchy via `throwForResponse`. Only
 * idempotent requests (GET, DELETE, and media downloads) are retried on
 * 429/503; WHEP and app-integration writes are sent once. A 401 calls
 * `onUnauthorized` (for example `tokenManager.invalidate`) and retries once.
 */

export interface RingClientOptions {
  /** Defaults to `DEFAULT_RING_API_BASE`. */
  readonly baseUrl?: string
  /** Returns the current bearer access token (may be async). */
  readonly getAccessToken: () => string | Promise<string>
  readonly fetch?: FetchLike
  readonly onRateLimit?: (info: RateLimitInfo) => void
  readonly now?: () => number
  readonly maxRetries?: number
  /** Called on a 401 before the single retry; omit to surface the 401. */
  readonly onUnauthorized?: () => void | Promise<void>
}

export interface MediaResult {
  /** The presigned media URL the 303 redirected to. */
  readonly url: string
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly origin: string | undefined
  readonly encrypted: boolean | undefined
  readonly length: number | undefined
}
export type SnapshotResult = MediaResult
export type ClipResult = MediaResult

export interface HistoryPage {
  readonly events: readonly HistoryEvent[]
  /** `links.next` or `meta.page_key`: pass back as `pageKey` (both are handled). */
  readonly nextUrl: string | null | undefined
  readonly document: HistoryDocument
}

export interface HistoryAllOptions {
  /** Only events at or after this epoch ms; pagination stops once older. */
  readonly sinceMs?: number
  /** Delay between pages (pacing under the shared rate limit). */
  readonly pageDelayMs?: number
  readonly sleep?: SleepFn
}

interface RequestOptions {
  /** Overrides the method-based default (media POSTs are idempotent reads). */
  readonly idempotent?: boolean
}

export class RingClient {
  readonly baseUrl: string
  private readonly getAccessToken: () => string | Promise<string>
  private readonly retry: RetryOptions
  private readonly onUnauthorized: (() => void | Promise<void>) | undefined

  constructor(options: RingClientOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_RING_API_BASE).replace(/\/+$/, "")
    this.getAccessToken = options.getAccessToken
    this.onUnauthorized = options.onUnauthorized
    this.retry = {
      fetch: resolveFetch(options.fetch),
      onRateLimit: options.onRateLimit,
      now: options.now,
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    }
  }

  private url(pathOrUrl: string): string {
    return resolveUrl(this.baseUrl, pathOrUrl)
  }

  private async send(url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
    const token = await this.getAccessToken()
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${token}`)
    if (!headers.has("accept")) headers.set("accept", CONTENT_TYPES.jsonApi)
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", CONTENT_TYPES.json)
    }
    const idempotent = options.idempotent ?? isIdempotent(init.method)
    const retry = idempotent ? this.retry : { ...this.retry, maxRetries: 0 }
    return requestWithRetry(url, { ...init, headers }, retry)
  }

  private async request(path: string, init: RequestInit = {}, options: RequestOptions = {}) {
    const url = this.url(path)
    const response = await this.send(url, init, options)
    if (response.status !== 401 || this.onUnauthorized === undefined) return response
    await response.text()
    await this.onUnauthorized()
    return this.send(url, init, options)
  }

  private async getDocument<T>(path: string, schema: SafeParser<T>, label: string): Promise<T> {
    const response = await this.request(path)
    if (!response.ok) await throwForResponse(response, "GET", this.url(path))
    return parseOrThrow(schema, label, await response.json(), this.url(path))
  }

  /** Sends a JSON body; an empty 2xx body (204) resolves to null. */
  private async writeDocument<T>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: unknown,
    schema: SafeParser<T>,
    label: string
  ): Promise<T | null> {
    const init: RequestInit =
      body === undefined ? { method } : { method, body: JSON.stringify(body) }
    const response = await this.request(path, init)
    if (!response.ok) await throwForResponse(response, method, this.url(path))
    const json = await readJsonOrEmpty(response)
    return json === undefined ? null : parseOrThrow(schema, label, json, this.url(path), method)
  }

  /** The authenticated user (used right after token exchange). */
  me(): Promise<UserDocument> {
    return this.getDocument(ENDPOINTS.me, userDocumentSchema, "me")
  }

  devices(options: { readonly include?: readonly DeviceInclude[] } = {}) {
    const query = options.include?.length
      ? `?include=${options.include.map((value) => encodeURIComponent(value)).join(",")}`
      : ""
    return this.getDocument(`${ENDPOINTS.devices}${query}`, deviceListDocumentSchema, "devices")
  }

  device(id: string) {
    return this.getDocument(ENDPOINTS.device(id), deviceDocumentSchema, "device")
  }

  deviceStatus(id: string) {
    return this.getDocument(ENDPOINTS.deviceStatus(id), deviceStatusDocumentSchema, "deviceStatus")
  }

  deviceCapabilities(id: string) {
    return this.getDocument(
      ENDPOINTS.deviceCapabilities(id),
      deviceCapabilitiesDocumentSchema,
      "deviceCapabilities"
    )
  }

  deviceConfigurations(id: string) {
    return this.getDocument(
      ENDPOINTS.deviceConfigurations(id),
      deviceConfigurationsDocumentSchema,
      "deviceConfigurations"
    )
  }

  deviceLocation(id: string) {
    return this.getDocument(ENDPOINTS.deviceLocation(id), deviceLocationDocumentSchema, "deviceLocation")
  }

  /**
   * One page of history events. `eventTypes` is sent as `event_types` and
   * also applied client-side, because whether the server honours the filter
   * is unverified: the Playground sandbox history is empty (friction log
   * entry 3). `pageKey` may be a `links.next` URL or an opaque
   * `meta.page_key` cursor.
   */
  async historyEvents(id: string, query: HistoryQuery = {}): Promise<HistoryPage> {
    const path = historyPagePath(id, query)
    const document = await this.getDocument(path, historyDocumentSchema, "historyEvents")
    const events = query.eventTypes?.length
      ? document.data.filter((event) => query.eventTypes?.includes(event.attributes.event_type))
      : document.data
    return { events, nextUrl: document.links?.next ?? document.meta?.page_key ?? null, document }
  }

  /** All history pages (newest first), with client-side filtering and pacing. */
  async historyEventsAll(
    id: string,
    query: Omit<HistoryQuery, "pageKey"> = {},
    maxPages = 20,
    options: HistoryAllOptions = {}
  ): Promise<readonly HistoryEvent[]> {
    const sleep = options.sleep ?? defaultSleep
    const since = options.sinceMs ?? Number.NEGATIVE_INFINITY
    const collect = async (pageKey: string | undefined, pages: number, acc: readonly HistoryEvent[]) => {
      const page = await this.historyEvents(id, pageKey ? { ...query, pageKey } : query)
      const fresh = page.events.filter((event) => event.attributes.timestamp >= since)
      const reachedSince = page.document.data.some((event) => event.attributes.timestamp < since)
      const next = [...acc, ...fresh]
      if (!page.nextUrl || reachedSince || pages + 1 >= maxPages) return next
      if (options.pageDelayMs) await sleep(options.pageDelayMs)
      return collect(page.nextUrl, pages + 1, next)
    }
    return collect(undefined, 0, [])
  }

  /**
   * Requests a snapshot and follows the 303 redirect to the presigned URL,
   * returning both the URL and the image bytes. 416/425/403/404/422 map to the
   * typed errors via `throwForResponse`.
   */
  async snapshot(deviceId: string, request: SnapshotRequestInput): Promise<SnapshotResult> {
    const body = snapshotRequestSchema.parse(request)
    return this.downloadMedia(ENDPOINTS.imageDownload(deviceId), body)
  }

  /** Requests a video clip (capped at 15 minutes) and downloads the bytes. */
  async clip(deviceId: string, request: ClipRequest): Promise<MediaResult> {
    if (request.end_time - request.start_time > 15 * 60 * 1000) {
      throw new RangeError("clip duration exceeds the 15 minute cap")
    }
    return this.downloadMedia(ENDPOINTS.videoDownload(deviceId), request)
  }

  private async downloadMedia(path: string, body: unknown): Promise<MediaResult> {
    const response = await this.request(
      path,
      { method: "POST", redirect: "manual", body: JSON.stringify(body) },
      { idempotent: true }
    )
    if (!(response.ok || response.status === 303)) {
      await throwForResponse(response, "POST", this.url(path))
    }
    return this.followMedia(response)
  }

  /**
   * The presigned URL is fetched WITHOUT the Ring bearer token (it carries
   * its own signature, and the token must never leave for a storage host).
   * Media metadata headers are read from Ring's 303 first.
   */
  private async followMedia(response: Response): Promise<MediaResult> {
    const location = response.headers.get(HEADERS.location)
    if (response.status !== 303 || !location) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      return {
        url: response.url,
        bytes,
        contentType: response.headers.get("content-type") ?? "application/octet-stream",
        ...mediaHeaders(response, response),
      }
    }
    const url = this.url(location)
    const media = await requestWithRetry(url, { method: "GET" }, this.retry)
    if (!media.ok) await throwForResponse(media, "GET", url)
    return {
      url,
      bytes: new Uint8Array(await media.arrayBuffer()),
      contentType: media.headers.get("content-type") ?? "application/octet-stream",
      ...mediaHeaders(response, media),
    }
  }

  /**
   * WHEP signaling: POSTs the SDP offer (sent once, never retried), reads the
   * SDP answer body and the session URL from `Location`. Keep the session URL
   * for `whepStop`; sessions are not reaped by Ring.
   */
  async whepStart(deviceId: string, sdpOffer: string): Promise<{ sdpAnswer: string; sessionUrl: string }> {
    const path = ENDPOINTS.whepSessions(deviceId)
    const response = await this.request(path, {
      method: "POST",
      headers: { "content-type": CONTENT_TYPES.sdp, accept: CONTENT_TYPES.sdp },
      body: sdpOffer,
    })
    if (!response.ok) await throwForResponse(response, "POST", this.url(path))
    const sdpAnswer = await response.text()
    const location = response.headers.get(HEADERS.location)
    const sessionUrl = location ? this.url(location) : ""
    return whepStartResponseSchema.parse({ sdpAnswer, sessionUrl })
  }

  async whepStop(sessionUrl: string): Promise<void> {
    const response = await this.request(sessionUrl, { method: "DELETE" })
    if (!response.ok && response.status !== 404) {
      await throwForResponse(response, "DELETE", this.url(sessionUrl))
    }
  }

  /**
   * The account's Ring subscriptions. A 422 (seen for Playground users)
   * becomes `RingNotAvailableForAccountError`: treat it as "not available
   * for this account" rather than a failure.
   */
  async subscriptions(): Promise<SubscriptionListDocument> {
    try {
      return await this.getDocument(ENDPOINTS.subscriptions, subscriptionListDocumentSchema, "subscriptions")
    } catch (error) {
      if (!(error instanceof RingUnprocessableError)) throw error
      throw new RingNotAvailableForAccountError(
        { status: error.status, method: error.method, url: error.url, document: error.document, cause: error },
        "subscriptions"
      )
    }
  }

  /** Step 8a: `POST app-integrations { account_identifier, nonce }` (status awaiting). */
  appIntegrationConfirm(request: AppIntegrationConfirmRequest): Promise<AppIntegrationDocument | null> {
    return this.writeDocument(
      "POST",
      ENDPOINTS.appIntegrations,
      request,
      appIntegrationDocumentSchema,
      "appIntegrationConfirm"
    )
  }

  /** Step 8b: `PATCH app-integrations { status: "completed" }`; without it the integration stays Inactive. */
  appIntegrationComplete(): Promise<AppIntegrationDocument | null> {
    return this.writeDocument(
      "PATCH",
      ENDPOINTS.appIntegrations,
      { status: "completed" },
      appIntegrationDocumentSchema,
      "appIntegrationComplete"
    )
  }

  /** Removes the integration (DELETE; confirm the verb in the Playground explorer). */
  appIntegrationDelete(): Promise<AppIntegrationDocument | null> {
    return this.writeDocument(
      "DELETE",
      ENDPOINTS.appIntegrations,
      undefined,
      appIntegrationDocumentSchema,
      "appIntegrationDelete"
    )
  }
}
