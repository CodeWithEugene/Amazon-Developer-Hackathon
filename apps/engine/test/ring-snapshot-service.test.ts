import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import type { Snapshot } from "@visitproof/domain"
import { RingClient } from "@visitproof/ring-partner-sdk"
import { mockClient } from "aws-sdk-client-mock"
import { afterEach, describe, expect, it } from "vitest"

import {
  InMemoryClientStore,
  InMemoryDoorEventStore,
  RingS3SnapshotService,
} from "../src"
import { doorEvent, silentLogger, testClient, testVisit } from "./helpers"

const s3 = mockClient(S3Client)
afterEach(() => s3.reset())

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const MEDIA_URL = "https://media.ring.test/presigned/frame.jpg"
const ARRIVAL = "2026-10-01T12:04:00.000Z"

type Route = {
  status: number
  headers?: Record<string, string>
  body?: BodyInit
}

/** A fetch double for the Ring 303 flow: POST download, then GET the media URL. */
const ringFetch = (post: Route, calls: string[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? "GET"} ${url}`)
    if (url === MEDIA_URL) {
      return new Response(JPEG, {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "x-media-origin": "recording",
        },
      })
    }
    return new Response(post.body ?? null, {
      status: post.status,
      headers: post.headers,
    })
  }) as typeof fetch

async function setup(post: Route, clientOverrides = {}) {
  const events = new InMemoryDoorEventStore()
  const arrival = doorEvent(ARRIVAL, "ding", { provenance: "ring_webhook" })
  await events.append(arrival)
  const visit = testVisit({
    status: "in_progress",
    arrival: { at: ARRIVAL, eventId: arrival.requestId, source: "rule" },
  })
  const stored: Snapshot[] = []
  const calls: string[] = []
  const service = new RingS3SnapshotService({
    ring: new RingClient({
      getAccessToken: () => "test-token",
      fetch: ringFetch(post, calls),
      maxRetries: 0,
    }),
    s3: new S3Client({ region: "us-east-1" }),
    bucket: "visitproof-media",
    clients: new InMemoryClientStore([testClient(clientOverrides)]),
    events,
    records: {
      put: async (snapshot) => void stored.push(snapshot),
      listForVisit: async (visitId) =>
        stored.filter((s) => s.visitId === visitId),
    },
    clock: { now: () => new Date("2026-10-01T12:04:30.000Z") },
    logger: silentLogger(),
  })
  return { service, visit, stored, calls }
}

const redirect: Route = { status: 303, headers: { location: MEDIA_URL } }

describe("Ring snapshot to S3", () => {
  it("follows the 303, stores the frame with a retention tag, and records a Snapshot", async () => {
    s3.on(PutObjectCommand).resolves({})
    const { service, visit, stored, calls } = await setup(redirect)
    const outcome = await service.fetch(visit)

    expect(outcome.status).toBe("stored")
    expect(calls[0]).toMatch(
      /^POST .*\/devices\/dev-1\/media\/image\/download$/
    )
    expect(calls[1]).toBe(`GET ${MEDIA_URL}`)
    const put = s3.commandCalls(PutObjectCommand)[0]?.args[0].input
    expect(put?.Bucket).toBe("visitproof-media")
    expect(put?.Key).toBe(`snapshots/c1/v1/${Date.parse(ARRIVAL)}.jpg`)
    expect(put?.Tagging).toBe("retention-days=7")
    expect(put?.ContentType).toBe("image/jpeg")
    expect(stored[0]).toMatchObject({
      visitId: "v1",
      mediaOrigin: "recording",
      provenance: "ring_webhook",
    })
    const expected =
      Math.floor(Date.parse("2026-10-01T12:04:30.000Z") / 1000) + 7 * 86_400
    expect(stored[0]?.expiresAt).toBe(expected)

    expect(await service.fetch(visit)).toEqual({
      status: "skipped",
      reason: "already_stored",
    })
  })

  it("rounds the consent retention down to a lifecycle class", async () => {
    s3.on(PutObjectCommand).resolves({})
    const { service, visit } = await setup(redirect, {
      consent: { ...testClient().consent, snapshotRetentionDays: 10 },
    })
    await service.fetch(visit)
    expect(s3.commandCalls(PutObjectCommand)[0]?.args[0].input.Tagging).toBe(
      "retention-days=7"
    )
  })

  it("treats 416 MEDIA_NOT_FOUND as final and stores nothing", async () => {
    const { service, visit, stored } = await setup({ status: 416 })
    expect(await service.fetch(visit)).toEqual({ status: "no_media" })
    expect(stored).toEqual([])
    expect(s3.commandCalls(PutObjectCommand)).toHaveLength(0)
  })

  it("reports 425 RECORDING_NOT_READY for a later retry", async () => {
    const { service, visit } = await setup({
      status: 425,
      headers: { "retry-after": "5" },
    })
    const outcome = await service.fetch(visit)
    expect(outcome.status).toBe("not_ready")
  })

  it("never requests media without snapshot consent or while the link is paused", async () => {
    const off = await setup(redirect, {
      consent: { ...testClient().consent, snapshotsEnabled: false },
    })
    expect(await off.service.fetch(off.visit)).toEqual({
      status: "skipped",
      reason: "consent",
    })
    expect(off.calls).toEqual([])
    const paused = await setup(redirect, { ringLinkStatus: "paused" })
    expect(await paused.service.fetch(paused.visit)).toEqual({
      status: "skipped",
      reason: "consent",
    })
  })

  it("never stores an encrypted frame", async () => {
    const encrypted = (async (input: RequestInfo | URL) =>
      String(input) === MEDIA_URL
        ? new Response(JPEG, {
            status: 200,
            headers: { "x-media-encrypted": "true" },
          })
        : new Response(null, {
            status: 303,
            headers: { location: MEDIA_URL },
          })) as typeof fetch
    const { visit } = await setup(redirect)
    const events = new InMemoryDoorEventStore()
    await events.append(
      doorEvent(ARRIVAL, "ding", { requestId: visit.arrival?.eventId })
    )
    const service = new RingS3SnapshotService({
      ring: new RingClient({
        getAccessToken: () => "t",
        fetch: encrypted,
        maxRetries: 0,
      }),
      s3: new S3Client({}),
      bucket: "b",
      clients: new InMemoryClientStore([testClient()]),
      events,
      records: { put: async () => undefined, listForVisit: async () => [] },
      clock: { now: () => new Date("2026-10-01T12:05:00.000Z") },
    })
    expect(await service.fetch(visit)).toEqual({ status: "encrypted" })
  })
})
