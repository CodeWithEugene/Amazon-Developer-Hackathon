import { CONTENT_TYPES, ENDPOINTS, HEADERS } from "./endpoints"
import {
  requestWithRetry,
  resolveFetch,
  throwForResponse,
  type FetchLike,
  type RateLimitInfo,
  type RetryOptions,
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
  type ClipRequest,
  type DeviceInclude,
  type HistoryEvent,
  type HistoryQuery,
} from "./types"
import { parseErrorDocument, RingNotFoundError, RingSchemaError } from "./errors"
import { snapshotRequestSchema, type SnapshotRequestInput } from "./media"

/**
 * Typed client for the Ring Partner API. Every method validates the response
 * against its Zod schema (`RingSchemaError` on mismatch) and maps non-2xx
 * statuses to the typed error hierarchy via `throwForResponse`.
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

const parseOrThrow = <T>(
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  label: string,
  body: unknown,
  url: string
): T => {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new RingSchemaError(
      { status: 200, method: "GET", url, document: parseErrorDocument(body) },
      `${label} response did not match the expected schema`
    )
  }
  return parsed.data
}

const numberHeader = (response: Response, name: string): number | undefined => {
  const value = response.headers.get(name)
  if (value === null || !/^\d+$/.test(value)) return undefined
  return Number(value)
}

export class RingClient {
  readonly baseUrl: string
  private readonly getAccessToken: () => string | Promise<string>
  private readonly retry: RetryOptions

  constructor(options: RingClientOptions) {
    this.baseUrl = (options.baseUrl ?? "https://api.amazonvision.com").replace(/\/+$/, "")
    this.getAccessToken = options.getAccessToken
    this.retry = {
      fetch: resolveFetch(options.fetch),
      onRateLimit: options.onRateLimit,
      now: options.now,
      ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken()
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${token}`)
    headers.set("accept", headers.get("accept") ?? CONTENT_TYPES.jsonApi)
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", CONTENT_TYPES.json)
    }
    return requestWithRetry(url, { ...init, headers }, this.retry)
  }

  private async getDocument<T>(
    path: string,
    schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
    label: string
  ): Promise<T> {
    const response = await this.request(path)
    if (!response.ok) await throwForResponse(response, "GET", `${this.baseUrl}${path}`)
    return parseOrThrow(schema, label, await response.json(), `${this.baseUrl}${path}`)
  }

  private async postDocument<T>(
    path: string,
    body: unknown,
    schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
    label: string
  ): Promise<T> {
    const response = await this.request(path, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
    if (!response.ok) await throwForResponse(response, "POST", `${this.baseUrl}${path}`)
    return parseOrThrow(schema, label, await response.json(), `${this.baseUrl}${path}`)
  }

  /** The authenticated user (used right after token exchange). */
  me(): Promise<ReturnType<typeof userDocumentSchema.parse>> {
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
   * One page of history events. `eventTypes` is applied client-side because the
   * documented `event_types` filter was observed to be ignored (friction log
   * entry 3). Follows `pageKey`/`links.next` for further pages.
   */
  async historyEvents(id: string, query: HistoryQuery = {}): Promise<{
    readonly events: readonly HistoryEvent[]
    readonly nextUrl: string | null | undefined
    readonly document: ReturnType<typeof historyDocumentSchema.parse>
  }> {
    const path = query.pageKey
      ? query.pageKey.startsWith("http")
        ? query.pageKey
        : `${this.baseUrl}${query.pageKey}`
      : ENDPOINTS.historyEvents(id)
    const document = await this.getDocument(path, historyDocumentSchema, "historyEvents")
    const events = query.eventTypes?.length
      ? document.data.filter((event) => query.eventTypes?.includes(event.attributes.event_type))
      : document.data
    return { events, nextUrl: document.links?.next ?? document.meta?.page_key ?? null, document }
  }

  /** All history pages, auto-following `links.next`, with client-side filtering. */
  async historyEventsAll(
    id: string,
    query: Omit<HistoryQuery, "pageKey"> = {},
    maxPages = 20
  ): Promise<readonly HistoryEvent[]> {
    const all: HistoryEvent[] = []
    let nextUrl: string | null | undefined
    let pages = 0
    do {
      const page: Awaited<ReturnType<typeof RingClient.prototype.historyEvents>> = await this.historyEvents(
        id,
        nextUrl ? { ...query, pageKey: nextUrl } : query
      )
      all.push(...page.events)
      nextUrl = page.nextUrl
      pages += 1
    } while (nextUrl && pages < maxPages)
    return all
  }

  /**
   * Requests a snapshot and follows the 303 redirect to the presigned URL,
   * returning both the URL and the image bytes. 416/425/403/404/422 map to the
   * typed errors via `throwForResponse`.
   */
  async snapshot(deviceId: string, request: SnapshotRequestInput): Promise<SnapshotResult> {
    const body = snapshotRequestSchema.parse(request)
    const response = await this.request(ENDPOINTS.imageDownload(deviceId), {
      method: "POST",
      redirect: "manual",
      body: JSON.stringify(body),
    })
    if (!(response.ok || response.status === 303)) {
      await throwForResponse(response, "POST", ENDPOINTS.imageDownload(deviceId))
    }
    return this.followMedia(response)
  }

  /** Requests a video clip (capped at 15 minutes) and downloads the bytes. */
  async clip(deviceId: string, request: ClipRequest): Promise<MediaResult> {
    if (request.end_time - request.start_time > 15 * 60 * 1000) {
      throw new RangeError("clip duration exceeds the 15 minute cap")
    }
    const response = await this.request(ENDPOINTS.videoDownload(deviceId), {
      method: "POST",
      redirect: "manual",
      body: JSON.stringify(request),
    })
    if (!(response.ok || response.status === 303)) {
      await throwForResponse(response, "POST", ENDPOINTS.videoDownload(deviceId))
    }
    return this.followMedia(response)
  }

  private async followMedia(response: Response): Promise<MediaResult> {
    const location = response.headers.get(HEADERS.location)
    if (!location) {
      throw new RingNotFoundError({ status: response.status, method: "POST", url: response.url })
    }
    const url = location.startsWith("http") ? location : `${this.baseUrl}${location}`
    const media = await this.request(url)
    if (!media.ok) await throwForResponse(media, "GET", url)
    const encrypted = media.headers.get(HEADERS.mediaEncrypted) === "true" || undefined
    return {
      url,
      bytes: new Uint8Array(await media.arrayBuffer()),
      contentType: media.headers.get("content-type") ?? "application/octet-stream",
      origin: media.headers.get(HEADERS.mediaOrigin) ?? undefined,
      encrypted,
      length: numberHeader(media, HEADERS.mediaLength),
    }
  }

  /**
   * WHEP signaling: POSTs the SDP offer, reads the SDP answer body and the
   * session URL from the `Location` header. Keep the session URL for `whepStop`.
   */
  async whepStart(deviceId: string, sdpOffer: string): Promise<{ sdpAnswer: string; sessionUrl: string }> {
    const response = await this.request(ENDPOINTS.whepSessions(deviceId), {
      method: "POST",
      headers: { "content-type": CONTENT_TYPES.sdp },
      body: sdpOffer,
    })
    if (!response.ok) await throwForResponse(response, "POST", ENDPOINTS.whepSessions(deviceId))
    const sdpAnswer = await response.text()
    const sessionUrl = response.headers.get(HEADERS.location) ?? ""
    return whepStartResponseSchema.parse({ sdpAnswer, sessionUrl })
  }

  async whepStop(sessionUrl: string): Promise<void> {
    const response = await this.request(sessionUrl, { method: "DELETE" })
    if (!response.ok && response.status !== 404) {
      await throwForResponse(response, "DELETE", sessionUrl)
    }
  }

  subscriptions() {
    return this.getDocument(ENDPOINTS.subscriptions, subscriptionListDocumentSchema, "subscriptions")
  }

  async appIntegrationConfirm(request: AppIntegrationConfirmRequest) {
    return this.postDocument(
      ENDPOINTS.appIntegrations,
      request,
      appIntegrationDocumentSchema,
      "appIntegrationConfirm"
    )
  }

  appIntegrationComplete() {
    return this.postDocument(
      ENDPOINTS.appIntegrations,
      { status: "completed" },
      appIntegrationDocumentSchema,
      "appIntegrationComplete"
    )
  }

  appIntegrationDelete() {
    return this.postDocument(
      ENDPOINTS.appIntegrations,
      { status: "deleted" },
      appIntegrationDocumentSchema,
      "appIntegrationDelete"
    )
  }
}
