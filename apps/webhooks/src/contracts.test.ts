import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository, type VisitProofRepository } from "@visitproof/db"
import type { Client } from "@visitproof/domain"
import { RingEmulator, signWebhookBody } from "@visitproof/ring-partner-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createMemoryArchive } from "./archive"
import { readReceiverConfig } from "./config"
import { createApp, type DeferFn, type WebhookAppOptions } from "./index"

const KEY = "contract-key"
const AGENCY = "a1"
const ACCOUNT = "ava1.ring.account.contract"
const silent = { warn: vi.fn(), error: vi.fn() }

let repo: VisitProofRepository

const client = (ringLinkStatus: Client["ringLinkStatus"]): Client => ({
  id: "cli_1",
  agencyId: AGENCY,
  name: "Test Client",
  homeLabel: "Home",
  familyContacts: [],
  ringLinkStatus,
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: false,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["T1019"],
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
})

const post = (body: Uint8Array | string, headers: Record<string, string> = {}) => {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  return new Request("http://localhost/webhooks/ring", {
    method: "POST",
    headers: { "x-signature": signWebhookBody(bytes, KEY), ...headers },
    body: bytes.slice().buffer,
  })
}

const app = (options: Partial<WebhookAppOptions> = {}) =>
  createApp({ repository: repo, signingKey: KEY, agencyId: AGENCY, logger: silent, ...options })

const emu = () => new RingEmulator({ signingKey: KEY })

beforeEach(async () => {
  repo = createLocalRepository(await mkdtemp(join(tmpdir(), "visitproof-contracts-")))
  await repo.clients.put(client("linked"))
  await repo.ringLinks.link("cli_1", ACCOUNT, new Date())
})

describe("C4 provenance", () => {
  it("labels emulated deliveries only in demo mode with the header", async () => {
    const delivery = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 1_000 })
    await app({ mode: "demo" }).request(post(delivery.rawBody, { ...delivery.headers }))
    const [event] = await repo.events.byClient("cli_1")
    expect(event?.provenance).toBe("emulated")
  })

  it("ignores the header in live mode and without it in demo mode", async () => {
    const one = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 1_000 })
    const two = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 2_000 })
    await app({ mode: "live" }).request(post(one.rawBody, { ...one.headers }))
    await app({ mode: "demo" }).request(post(two.rawBody))
    const events = await repo.events.byClient("cli_1")
    expect(events.map((event) => event.provenance)).toEqual(["ring_webhook", "ring_webhook"])
  })
})

describe("C5 ack before engine work", () => {
  it("responds 202 while the engine is still running", async () => {
    let finish: (() => void) | undefined
    const onEvent = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    let scheduled: (() => Promise<void>) | undefined
    const defer: DeferFn = (task) => {
      scheduled = task
    }
    const delivery = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 1_000 })
    const res = await app({ onEvent, defer }).request(post(delivery.rawBody))
    expect(res.status).toBe(202)
    expect(onEvent).not.toHaveBeenCalled()
    const running = scheduled?.()
    expect(onEvent).toHaveBeenCalledTimes(1)
    finish?.()
    await running
  })

  it("never runs the engine when VISITPROOF_ENGINE_INLINE is false", async () => {
    const onEvent = vi.fn()
    const defer = vi.fn()
    const delivery = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 1_000 })
    const res = await app({ onEvent, defer, engineInline: false }).request(post(delivery.rawBody))
    expect(res.status).toBe(202)
    expect(defer).not.toHaveBeenCalled()
    expect(await repo.events.byClient("cli_1")).toHaveLength(1)
  })

  it("reads the flags from the environment", () => {
    expect(readReceiverConfig({}).engineInline).toBe(true)
    expect(readReceiverConfig({ VISITPROOF_ENGINE_INLINE: "false" }).engineInline).toBe(false)
    expect(readReceiverConfig({ VISITPROOF_ENGINE_INLINE: "TRUE" }).engineInline).toBe(true)
    expect(readReceiverConfig({ VISITPROOF_MODE: "live" }).mode).toBe("live")
    expect(readReceiverConfig({}).mode).toBe("demo")
  })
})

describe("C3 removed integration", () => {
  it("acknowledges but neither persists nor processes", async () => {
    await repo.clients.put(client("removed"))
    const onEvent = vi.fn()
    const defer = vi.fn()
    const delivery = emu().ding({ deviceId: "dev1", accountId: ACCOUNT, at: 1_000 })
    const res = await app({ onEvent, defer }).request(post(delivery.rawBody))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, ignored: "integration_removed" })
    expect(await repo.events.byClient("cli_1")).toHaveLength(0)
    expect(defer).not.toHaveBeenCalled()
  })
})

describe("open event vocabulary", () => {
  const envelope = (data: Record<string, unknown>) =>
    JSON.stringify({
      meta: { version: "1.1", time: "2026-10-01T14:00:00.000Z", request_id: "req-open-1", account_id: ACCOUNT },
      data,
    })

  it("stores an unknown data.type raw with its type and acks 202", async () => {
    const archive = createMemoryArchive()
    const body = envelope({
      id: "dev1_glass_1",
      type: "glass_break_detected",
      attributes: { source: "dev1", source_type: "devices", timestamp: 5 },
    })
    const res = await app({ archive }).request(post(body))
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, requestId: "req-open-1", stored: "raw", rawType: "glass_break_detected" })
    expect(archive.records()).toEqual([
      expect.objectContaining({ requestId: "req-open-1", rawType: "glass_break_detected", accountId: ACCOUNT, rawBody: body }),
    ])
    expect(await repo.events.byClient("cli_1")).toHaveLength(0)
  })

  it("persists motion with an unknown sub_type as motion", async () => {
    const body = envelope({
      id: "dev1_motion_7",
      type: "motion_detected",
      attributes: { source: "dev1", source_type: "devices", timestamp: 7, sub_type: "package" },
    })
    expect((await app().request(post(body))).status).toBe(202)
    const [event] = await repo.events.byClient("cli_1")
    expect(event).toMatchObject({ type: "motion", subType: "package" })
  })
})
