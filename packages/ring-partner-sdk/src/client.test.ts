import { describe, expect, it, vi } from "vitest"

import { RingClient } from "./client"
import type { FetchLike } from "./http"
import {
  createTokenManager,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from "./oauth"
import {
  RingMediaNotFoundError,
  RingRateLimitError,
  RingRecordingNotReadyError,
  RingTimeRangeNotAuthorizedError,
} from "./errors"

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/vnd.api+json", ...init.headers },
    ...init,
  })

const userDoc = { data: { id: "user1", type: "users", attributes: { email: "a@b.c" } } }
const devicesDoc = {
  data: [
    {
      id: "dev1",
      type: "devices",
      attributes: { name: "Front Door", kind: "doorbell" },
    },
  ],
}
const historyPage = (ids: string[], next?: string | null) => ({
  data: ids.map((id, i) => ({
    id,
    type: "history_events",
    attributes: {
      event_type: i === 0 ? "ding" : i === 1 ? "motion.human" : "motion.vehicle",
      timestamp: 1_700_000_000_000 + i,
    },
  })),
  links: next ? { next } : {},
})

describe("RingClient", () => {
  const make = (
    handler: (url: string, init?: RequestInit) => Promise<Response> | Response
  ) => {
    const fetch = vi.fn(handler)
    const client = new RingClient({
      baseUrl: "https://api.test",
      getAccessToken: () => "token-1",
      fetch: fetch as unknown as FetchLike,
    })
    return { client, fetch }
  }

  it("sends the bearer token and parses me()", async () => {
    const { client, fetch } = make(() => jsonResponse(userDoc))
    const me = await client.me()
    expect(me.data.id).toBe("user1")
    expect(fetch.mock.calls[0]![1]!.headers).toBeInstanceOf(Headers)
    const headers = fetch.mock.calls[0]![1]!.headers as Headers
    expect(headers.get("authorization")).toBe("Bearer token-1")
  })

  it("lists devices with include query params", async () => {
    const { client, fetch } = make(() => jsonResponse(devicesDoc))
    const doc = await client.devices({ include: ["status", "capabilities"] })
    expect(doc.data[0]!.id).toBe("dev1")
    expect(fetch.mock.calls[0]![0]).toContain("/v1/devices?include=status,capabilities")
  })

  it("filters history client-side and follows pagination", async () => {
    const pages = [historyPage(["h1", "h2", "h3"], "/v1/devices/dev1/history/events?page=2"), historyPage(["h4", "h5"])]
    let call = 0
    const { client } = make(() => jsonResponse(pages[call++]))
    const all = await client.historyEventsAll("dev1", { eventTypes: ["motion.human", "motion.vehicle"] })
    expect(all.map((event) => event.attributes.event_type)).toEqual([
      "motion.human",
      "motion.vehicle",
      "motion.human",
    ])
  })

  it("maps media 416/425/403 to typed errors", async () => {
    for (const [status, Ctor] of [
      [416, RingMediaNotFoundError],
      [425, RingRecordingNotReadyError],
      [403, RingTimeRangeNotAuthorizedError],
    ] as const) {
      const { client } = make(() =>
        jsonResponse({ errors: [{ code: "X", detail: "nope" }] }, { status })
      )
      await expect(client.snapshot("dev1", { type: "at_timestamp", timestamp: 1 })).rejects.toBeInstanceOf(Ctor)
    }
  })

  it("follows the 303 presigned URL for a snapshot", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    let call = 0
    const { client } = make(() => {
      call += 1
      if (call === 1) {
        return new Response(null, {
          status: 303,
          headers: { location: "https://media.test/presigned.jpg" },
        })
      }
      return new Response(bytes, {
        headers: {
          "content-type": "image/jpeg",
          "x-media-origin": "snapshot",
          "x-media-length": "4",
        },
      })
    })
    const snapshot = await client.snapshot("dev1", { type: "at_timestamp", timestamp: 1 })
    expect(snapshot.url).toBe("https://media.test/presigned.jpg")
    expect(Array.from(snapshot.bytes)).toEqual([1, 2, 3, 4])
    expect(snapshot.origin).toBe("snapshot")
    expect(snapshot.length).toBe(4)
  })

  it("rejects a clip over 15 minutes before any request", async () => {
    const { client, fetch } = make(() => jsonResponse({}))
    await expect(
      client.clip("dev1", { start_time: 0, end_time: 16 * 60 * 1000 })
    ).rejects.toThrow(RangeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("starts and stops a WHEP session", async () => {
    const sessions: string[] = []
    const { client } = make((url, init) => {
      if (init?.method === "DELETE") {
        sessions.push(url)
        return new Response(null, { status: 204 })
      }
      return new Response("v=0 answer", {
        status: 201,
        headers: { location: "https://api.test/whep/sessions/s1" },
      })
    })
    const session = await client.whepStart("dev1", "v=0 offer")
    expect(session.sdpAnswer).toBe("v=0 answer")
    expect(session.sessionUrl).toBe("https://api.test/whep/sessions/s1")
    await client.whepStop(session.sessionUrl)
    expect(sessions).toEqual(["https://api.test/whep/sessions/s1"])
  })

  it("surfaces rate limit info and gives up with RingRateLimitError", async () => {
    const onRateLimit = vi.fn()
    let attempts = 0
    const client = new RingClient({
      baseUrl: "https://api.test",
      getAccessToken: () => "t",
      fetch: (() => {
        attempts += 1
        return Promise.resolve(new Response("{}", { status: 429, headers: { "retry-after": "0" } }))
      }) as FetchLike,
      onRateLimit,
      maxRetries: 1,
    })
    await expect(client.devices()).rejects.toBeInstanceOf(RingRateLimitError)
    expect(attempts).toBe(2)
    expect(onRateLimit).toHaveBeenCalledTimes(1)
  })
})

describe("oauth", () => {
  it("exchanges an authorization code with a form body", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 1800,
        token_type: "Bearer",
      })
    )
    const tokens = await exchangeAuthorizationCode({
      clientId: "cid",
      clientSecret: "cs",
      code: "the-code",
      fetch: fetch as unknown as typeof fetch,
    })
    expect(tokens.access_token).toBe("at")
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://oauth.ring.com/oauth/token")
    expect(String(init.body)).toContain("grant_type=authorization_code")
    expect(String(init.body)).toContain("code=the-code")
  })

  it("keeps the old refresh token when the server does not rotate", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ access_token: "at2", expires_in: 1800 })
    )
    const tokens = await refreshAccessToken({
      clientId: "cid",
      clientSecret: "cs",
      refreshToken: "rt-old",
      fetch: fetch as unknown as typeof fetch,
    })
    expect(tokens.refresh_token).toBe("rt-old")
    expect(tokens.access_token).toBe("at2")
  })

  it("refreshes once for concurrent callers (single flight)", async () => {
    let refreshes = 0
    let clock = 1_000
    const refresh = vi.fn(async () => {
      refreshes += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return {
        access_token: `at-${refreshes}`,
        refresh_token: `rt-${refreshes}`,
        expires_in: 1800,
        token_type: "Bearer",
      }
    })
    const manager = createTokenManager(
      {
        clientId: "cid",
        clientSecret: "cs",
        tokens: { access_token: "at-0", refresh_token: "rt-0", expires_in: 1800, token_type: "Bearer" },
        now: () => clock,
      },
      refresh as unknown as typeof refreshAccessToken
    )
    // Expire the first token.
    clock = 1_000 + 1800_000
    const [a, b, c] = await Promise.all([
      manager.getAccessToken(),
      manager.getAccessToken(),
      manager.getAccessToken(),
    ])
    expect(refreshes).toBe(1)
    expect(new Set([a, b, c])).toEqual(new Set(["at-1"]))
  })

  it("invalidation forces the next call to refresh", async () => {
    const clock = 1_000
    let refreshes = 0
    const refresh = vi.fn(async () => {
      refreshes += 1
      return {
        access_token: `at-${refreshes}`,
        refresh_token: "rt-x",
        expires_in: 1800,
        token_type: "Bearer",
      }
    })
    const manager = createTokenManager(
      {
        clientId: "cid",
        clientSecret: "cs",
        tokens: { access_token: "at-0", refresh_token: "rt-0", expires_in: 1800, token_type: "Bearer" },
        now: () => clock,
      },
      refresh as unknown as typeof refreshAccessToken
    )
    expect(await manager.getAccessToken()).toBe("at-0")
    manager.invalidate()
    expect(await manager.getAccessToken()).toBe("at-1")
    expect(refreshes).toBe(1)
  })
})
