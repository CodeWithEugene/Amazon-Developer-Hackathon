import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository } from "@visitproof/db"
import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import type { WebhookEnvelope } from "@visitproof/ring-partner-sdk"
import { signWebhookBody, unclaimedBucketId } from "@visitproof/ring-partner-sdk"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createApp, type DeferFn, type WebhookAppOptions } from "./index"

const KEY = "test-signing-key"

const envelope = (dataOverride?: WebhookEnvelope["data"]): WebhookEnvelope => {
  const data =
    dataOverride ??
    ({
      id: "dev1_motion_1786715596787",
      type: "motion_detected",
      attributes: {
        source: "dev1",
        source_type: "devices",
        timestamp: 1_759_328_400_000,
        sub_type: "human",
        component_ids: ["0"],
      },
      relationships: { devices: { links: { self: "/v1/devices/dev1" } } },
    } as WebhookEnvelope["data"])
  return {
    meta: {
      version: "1.1",
      time: "2026-10-01T14:00:00.000Z",
      request_id: "2ad45ade-0000-4000-8000-000000000001",
      account_id: "acct-1",
    },
    data,
  }
}

const bodyOf = (env: WebhookEnvelope): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(env))

/** The same bytes as an ArrayBuffer, which undici's BodyInit requires. */
const bodyBufferOf = (env: WebhookEnvelope): ArrayBuffer => {
  const bytes = bodyOf(env)
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
}

let dir: string
let repo: VisitProofRepository
let pending: Promise<void>[] = []

/** Collects deferred engine work so tests can flush it after the response. */
const collect: DeferFn = (task) => {
  pending = [...pending, task()]
}
const flush = async () => {
  await Promise.all(pending)
  pending = []
}
const makeApp = (options: Omit<WebhookAppOptions, "repository" | "signingKey"> & { repository?: VisitProofRepository } = {}) =>
  createApp({ repository: repo, signingKey: KEY, defer: collect, logger: { warn: vi.fn(), error: vi.fn() }, ...options })

beforeEach(async () => {
  pending = []
  dir = await mkdtemp(join(tmpdir(), "visitproof-webhooks-"))
  repo = createLocalRepository(dir)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const signedRequest = (
  env: WebhookEnvelope,
  key = KEY,
  headerName = "x-signature"
) => {
  const body = bodyOf(env)
  return new Request("http://localhost/webhooks/ring", {
    method: "POST",
    headers: { "content-type": "application/json", [headerName]: signWebhookBody(body, key) },
    body: bodyBufferOf(env),
  })
}

describe("POST /webhooks/ring", () => {
  it("accepts a correctly signed motion event and persists it", async () => {
    const onEvent = vi.fn()
    const app = makeApp({ onEvent })

    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const res = await app.request(await signedRequest(envelope()))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, requestId: envelope().meta.request_id })

    const events = await repo.events.byClient("client-1")
    expect(events).toHaveLength(1)
    const stored = events[0] as DoorEvent
    expect(stored.type).toBe("motion")
    expect(stored.subType).toBe("human")
    expect(stored.deviceId).toBe("dev1")
    expect(stored.provenance).toBe("ring_webhook")
    expect(stored.rawPayloadHash).toBe(
      createHash("sha256").update(bodyOf(envelope())).digest("hex")
    )

    await flush()
    expect(onEvent).toHaveBeenCalledTimes(1)
    const [eventArg, envelopeArg] = onEvent.mock.calls[0] as [
      DoorEvent | null,
      WebhookEnvelope
    ]
    expect(eventArg?.clientId).toBe("client-1")
    expect(envelopeArg.meta.request_id).toBe(envelope().meta.request_id)
  })

  it("rejects a tampered body with 401 and persists nothing", async () => {
    const app = makeApp()
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const request = await signedRequest(envelope())
    const tampered = new Request(request, {
      body: JSON.stringify({ ...envelope(), data: { ...envelope().data, id: "x" } }),
    })
    const res = await app.request(tampered)
    expect(res.status).toBe(401)
    expect(await repo.events.byClient("client-1")).toHaveLength(0)
  })

  it("rejects a signature made with the wrong key", async () => {
    const app = makeApp()
    const res = await app.request(await signedRequest(envelope(), "other-key"))
    expect(res.status).toBe(401)
  })

  it("rejects a missing signature header", async () => {
    const app = makeApp()
    const res = await app.request(
      new Request("http://localhost/webhooks/ring", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: bodyBufferOf(envelope()),
      })
    )
    expect(res.status).toBe(401)
  })

  it("rejects a validly signed but malformed body with 400", async () => {
    const app = makeApp()
    const body = new TextEncoder().encode("not json")
    const res = await app.request(
      new Request("http://localhost/webhooks/ring", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": signWebhookBody(body, KEY),
        },
        body,
      })
    )
    expect(res.status).toBe(400)
  })

  it("sweeps replays: a redelivered request id is a duplicate, not a second event", async () => {
    const onEvent = vi.fn()
    const app = makeApp({ onEvent })
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const first = await app.request(await signedRequest(envelope()))
    expect(first.status).toBe(202)
    const second = await app.request(await signedRequest(envelope()))
    expect(second.status).toBe(202)
    expect(await second.json()).toEqual({ ok: true, duplicate: true })

    expect(await repo.events.byClient("client-1")).toHaveLength(1)
    await flush()
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it("still returns 202 and keeps the event when the engine handler throws", async () => {
    const onEvent = vi.fn(() => {
      throw new Error("engine exploded")
    })
    const app = makeApp({ onEvent })
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const res = await app.request(await signedRequest(envelope()))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({
      ok: true,
      requestId: envelope().meta.request_id,
    })
    expect(await repo.events.byClient("client-1")).toHaveLength(1)
    await flush()
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it("does not strand the receipt when the event put fails", async () => {
    const failing: VisitProofRepository = {
      ...repo,
      events: {
        ...repo.events,
        put: async () => {
          throw new Error("dynamo down")
        },
      },
    }
    const app = makeApp({ repository: failing })
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const res = await app.request(await signedRequest(envelope()))
    expect(res.status).toBe(500)
    expect(await repo.events.byClient("client-1")).toHaveLength(0)
    // The receipt was never claimed, so Ring's retry is processed — not
    // acked as a `duplicate` with the event lost.
    expect(
      await repo.webhookReceipts.claim(envelope().meta.request_id, new Date())
    ).toBe(true)
  })

  it("processes the retry after a mid-flight failure instead of acking a duplicate", async () => {
    let failPut = true
    const flaky: VisitProofRepository = {
      ...repo,
      events: {
        ...repo.events,
        put: async (event) => {
          if (failPut) throw new Error("dynamo down")
          return repo.events.put(event)
        },
      },
    }
    const onEvent = vi.fn()
    const app = makeApp({ repository: flaky, onEvent })
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const first = await app.request(await signedRequest(envelope()))
    expect(first.status).toBe(500)

    failPut = false
    const retry = await app.request(await signedRequest(envelope()))
    expect(retry.status).toBe(202)
    expect(await retry.json()).toEqual({
      ok: true,
      requestId: envelope().meta.request_id,
    })
    expect(await repo.events.byClient("client-1")).toHaveLength(1)
    await flush()
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it("stores events for a not yet linked account in the unclaimed bucket", async () => {
    const onEvent = vi.fn()
    const app = makeApp({ onEvent })
    const res = await app.request(await signedRequest(envelope()))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, requestId: envelope().meta.request_id, unclaimed: true })
    const bucket = await repo.events.byClient(unclaimedBucketId("acct-1"))
    expect(bucket).toHaveLength(1)
    await flush()
    expect(onEvent).not.toHaveBeenCalled()
  })

  it("accepts subscription events but persists no door event", async () => {
    const onEvent = vi.fn()
    const app = makeApp({ onEvent })
    await repo.ringLinks.link("client-1", "acct-1", new Date())

    const env = envelope({
      id: "sub-1",
      type: "subscription_activated",
      attributes: {
        source: "sub-1",
        source_type: "subscriptions",
        timestamp: 1_759_328_400_000,
        subscription_id: "sub-1",
        plan: "basic",
      },
    })
    const res = await app.request(await signedRequest(env))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, ignored: "unmapped_event_type" })
    await flush()
    expect(onEvent).toHaveBeenCalledWith(null, env)
    expect(await repo.events.byClient("client-1")).toHaveLength(0)
  })

  it("serves the alias route POST /ring/webhook identically", async () => {
    const app = makeApp()
    const body = bodyOf(envelope())
    const res = await app.request(
      new Request("http://localhost/ring/webhook", {
        method: "POST",
        headers: { "x-signature": signWebhookBody(body, KEY) },
        body: bodyBufferOf(envelope()),
      })
    )
    expect(res.status).toBe(202)
  })

  it("answers health checks", async () => {
    const app = makeApp()
    const res = await app.request("http://localhost/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, service: "webhooks" })
  })
})
