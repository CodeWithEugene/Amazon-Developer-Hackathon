import { describe, expect, it } from "vitest"

import { RingClient } from "../client"
import { isNotAvailableForAccount, RingNotAvailableForAccountError, RingNotFoundError, RingUnprocessableError } from "../errors"
import type { FetchLike } from "../http"
import { PLAYGROUND_DEVICE_ID } from "../fixtures/playground"
import { createMockPlaygroundHandler, startMockPlayground } from "./mock-playground"
import { buildMockSdpAnswer } from "./mock-sdp"

/** The SDK, end to end, against the mock that serves the real captures. */

const BASE = "http://mock.playground.test"

const clientFor = (handler = createMockPlaygroundHandler()) => {
  const fetch: FetchLike = (input, init) => handler(new Request(String(input), init))
  return { handler, client: new RingClient({ baseUrl: BASE, getAccessToken: () => "mock-token", fetch, maxRetries: 0 }) }
}

const OFFER = [
  "v=0",
  "o=- 1 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "m=video 9 UDP/TLS/RTP/SAVPF 96 118",
  "a=mid:0",
  "a=recvonly",
  "a=rtpmap:96 VP8/90000",
  "a=rtpmap:118 H264/90000",
  "a=fmtp:118 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "a=mid:1",
  "a=recvonly",
  "a=rtpmap:111 opus/48000/2",
  "",
].join("\r\n")

describe("mock Playground through RingClient", () => {
  it("serves every captured read and the SDK parses each one", async () => {
    const { client } = clientFor()
    const id = PLAYGROUND_DEVICE_ID
    expect((await client.me()).data.type).toBe("users")
    expect((await client.devices()).data[0]?.attributes.name).toBe("Playground Device")
    expect((await client.devices({ include: ["status", "location"] })).included).toHaveLength(4)
    expect((await client.device(id)).data.id).toBe(id)
    expect((await client.deviceStatus(id)).data.attributes.online).toBe(true)
    expect((await client.deviceCapabilities(id)).data.attributes.battery_status).toBeNull()
    expect((await client.deviceConfigurations(id)).data.attributes.e2e_encryption?.enabled).toBe(false)
    expect((await client.deviceLocation(id)).data.attributes.state).toBe("CA")
    expect(await client.historyEventsAll(id)).toEqual([])
  })

  it("turns the subscriptions 422 into a typed not available error", async () => {
    const { client } = clientFor()
    const error = await client.subscriptions().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(RingNotAvailableForAccountError)
    expect(error).toBeInstanceOf(RingUnprocessableError)
    expect(isNotAvailableForAccount(error)).toBe(true)
    expect(error).toMatchObject({ status: 422, feature: "subscriptions" })
    expect((error as RingNotAvailableForAccountError).document?.errors[0]?.detail).toMatch(/subscription/)
  })

  it("starts and stops a WHEP session with an SDP answer", async () => {
    const { client, handler } = clientFor()
    const answer = await client.whepStart(PLAYGROUND_DEVICE_ID, OFFER)
    expect(answer.sdpAnswer).toMatch(/^v=0\r\n/)
    expect(answer.sessionUrl).toMatch(new RegExp(`^${BASE}/v1/devices/.+/media/streaming/whep/sessions/[0-9a-f-]{36}$`))
    expect(handler.activeSessions()).toHaveLength(1)
    await client.whepStop(answer.sessionUrl)
    expect(handler.activeSessions()).toHaveLength(0)
  })

  it("answers 404 for a device that is not shared and 401 without a token", async () => {
    const { client, handler } = clientFor()
    await expect(client.deviceStatus("someone-else")).rejects.toBeInstanceOf(RingNotFoundError)
    expect((await handler(new Request(`${BASE}/v1/users/me`))).status).toBe(401)
  })
})

describe("buildMockSdpAnswer", () => {
  it("mirrors each media section as sendonly with H264 and Opus", () => {
    const answer = buildMockSdpAnswer(OFFER)
    expect(answer).toContain("a=group:BUNDLE 0 1")
    expect(answer).toContain("m=video 9 UDP/TLS/RTP/SAVPF 118")
    expect(answer).toContain("a=fmtp:118 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f")
    expect(answer).toContain("m=audio 9 UDP/TLS/RTP/SAVPF 111")
    expect(answer.match(/a=sendonly/g)).toHaveLength(2)
    expect(answer).not.toContain("VP8")
  })
})

describe("startMockPlayground", () => {
  it("serves the fixtures over HTTP on an ephemeral local port", async () => {
    const mock = await startMockPlayground({ port: 0 })
    try {
      expect(mock.url).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*$/)
      const response = await fetch(`${mock.url}/v1/devices/${PLAYGROUND_DEVICE_ID}/status`, {
        headers: { authorization: "Bearer mock-token" },
      })
      expect(response.status).toBe(200)
      expect(((await response.json()) as { data: { type: string } }).data.type).toBe("device-status")
    } finally {
      await mock.close()
    }
  })
})
