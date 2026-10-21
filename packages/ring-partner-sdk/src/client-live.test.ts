import { describe, expect, it, vi } from "vitest"

import { RingClient } from "./client"
import type { FetchLike } from "./http"
import { RingServiceUnavailableError } from "./errors"

/**
 * Wire-level behaviors the review called out: verbs for app integrations,
 * no bearer token on presigned media, WHEP negotiation headers and no
 * retries for non-idempotent calls, opaque history cursors, and a single
 * retry after a 401 once the token was invalidated.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/vnd.api+json" },
  })

const integrationDoc = (status: string) => ({
  data: { id: "ai1", type: "app_integrations", attributes: { status } },
})

const make = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  const client = new RingClient({
    baseUrl: "https://api.test",
    getAccessToken: () => "token-1",
    fetch: fetch as unknown as FetchLike,
  })
  return { client, fetch }
}

const headersOf = (init: RequestInit | undefined): Headers => new Headers(init?.headers)

describe("app integrations", () => {
  it("confirms with POST and the nonce body", async () => {
    const { client, fetch } = make(() => json(integrationDoc("awaiting")))
    const doc = await client.appIntegrationConfirm({ account_identifier: "vp-client-1", nonce: "n1" })
    expect(doc?.data.attributes.status).toBe("awaiting")
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe("https://api.test/v1/accounts/me/app-integrations")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({ account_identifier: "vp-client-1", nonce: "n1" })
  })

  it("completes with PATCH and status completed", async () => {
    const { client, fetch } = make(() => json(integrationDoc("completed")))
    const doc = await client.appIntegrationComplete()
    expect(doc?.data.attributes.status).toBe("completed")
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe("https://api.test/v1/accounts/me/app-integrations")
    expect(init?.method).toBe("PATCH")
    expect(JSON.parse(String(init?.body))).toEqual({ status: "completed" })
  })

  it("accepts an empty 204 for complete and delete", async () => {
    const { client, fetch } = make(() => new Response(null, { status: 204 }))
    expect(await client.appIntegrationComplete()).toBeNull()
    expect(await client.appIntegrationDelete()).toBeNull()
    expect(fetch.mock.calls[1]![1]?.method).toBe("DELETE")
  })

  it("does not retry a non-idempotent PATCH on 503", async () => {
    const { client, fetch } = make(() => json({ errors: [{ code: "UNAVAILABLE" }] }, 503))
    await expect(client.appIntegrationComplete()).rejects.toBeInstanceOf(RingServiceUnavailableError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe("media redirect", () => {
  it("fetches the presigned URL without the bearer token and reads headers from the 303", async () => {
    const { client, fetch } = make((url) => {
      if (url.startsWith("https://api.test")) {
        return new Response(null, {
          status: 303,
          headers: {
            location: "https://media.test/presigned.jpg?sig=abc",
            "x-media-origin": "recording",
            "x-media-encrypted": "true",
            "x-media-length": "3",
          },
        })
      }
      return new Response(new Uint8Array([9, 8, 7]), { headers: { "content-type": "image/jpeg" } })
    })
    const result = await client.snapshot("dev1", { type: "at_timestamp", timestamp: 1 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(headersOf(fetch.mock.calls[0]![1]).get("authorization")).toBe("Bearer token-1")
    const presigned = fetch.mock.calls[1]!
    expect(presigned[0]).toBe("https://media.test/presigned.jpg?sig=abc")
    expect(headersOf(presigned[1]).get("authorization")).toBeNull()
    expect(result.origin).toBe("recording")
    expect(result.encrypted).toBe(true)
    expect(result.length).toBe(3)
    expect(Array.from(result.bytes)).toEqual([9, 8, 7])
  })
})

describe("WHEP", () => {
  it("negotiates SDP both ways and never retries the POST", async () => {
    const { client, fetch } = make(() => new Response("busy", { status: 503 }))
    await expect(client.whepStart("dev1", "v=0 offer")).rejects.toBeInstanceOf(RingServiceUnavailableError)
    expect(fetch).toHaveBeenCalledTimes(1)
    const headers = headersOf(fetch.mock.calls[0]![1])
    expect(headers.get("content-type")).toBe("application/sdp")
    expect(headers.get("accept")).toBe("application/sdp")
  })
})

describe("history pagination", () => {
  const page = (ids: string[], meta?: Record<string, unknown>, links?: Record<string, unknown>) => ({
    data: ids.map((id, index) => ({
      id,
      type: "history_events",
      attributes: { event_type: "ding", timestamp: 1_000 - index },
    })),
    ...(meta ? { meta } : {}),
    ...(links ? { links } : {}),
  })

  it("sends an opaque page_key as a query parameter on the device path", async () => {
    const pages = [page(["h1"], { page_key: "abc123" }), page(["h2"])]
    let call = 0
    const { client, fetch } = make(() => json(pages[call++]))
    const all = await client.historyEventsAll("dev 1")
    expect(all.map((event) => event.id)).toEqual(["h1", "h2"])
    expect(fetch.mock.calls[1]![0]).toBe("https://api.test/v1/devices/dev%201/history/events?page_key=abc123")
  })

  it("follows links.next as a URL and passes event_types on the first page", async () => {
    const pages = [page(["h1"], undefined, { next: "/v1/devices/dev1/history/events?cursor=2" }), page(["h2"])]
    let call = 0
    const { client, fetch } = make(() => json(pages[call++]))
    await client.historyEventsAll("dev1", { eventTypes: ["ding", "motion.human"] })
    expect(fetch.mock.calls[0]![0]).toBe(
      "https://api.test/v1/devices/dev1/history/events?event_types=ding,motion.human"
    )
    expect(fetch.mock.calls[1]![0]).toBe("https://api.test/v1/devices/dev1/history/events?cursor=2")
  })

  it("stops at sinceMs because pages are newest first", async () => {
    const pages = [page(["h1", "h2"], { page_key: "next" }), page(["h3"])]
    let call = 0
    const { client, fetch } = make(() => json(pages[call++]))
    const all = await client.historyEventsAll("dev1", {}, 20, { sinceMs: 1_000 })
    expect(all.map((event) => event.id)).toEqual(["h1"])
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe("401 handling", () => {
  it("invalidates and retries exactly once", async () => {
    let token = "stale"
    const onUnauthorized = vi.fn(() => {
      token = "fresh"
    })
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      headersOf(init).get("authorization") === "Bearer fresh"
        ? json({ data: { id: "u1", type: "users", attributes: {} } })
        : json({ errors: [{ code: "UNAUTHORIZED" }] }, 401)
    )
    const client = new RingClient({
      baseUrl: "https://api.test",
      getAccessToken: () => token,
      fetch: fetch as unknown as FetchLike,
      onUnauthorized,
    })
    expect((await client.me()).data.id).toBe("u1")
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
