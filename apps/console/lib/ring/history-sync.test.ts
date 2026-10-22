import { historyDocumentSchema, historyEventSchema, type HistoryEvent } from "@visitproof/ring-partner-sdk"
import { PLAYGROUND_DEVICE_ID, PLAYGROUND_FIXTURES } from "@visitproof/ring-partner-sdk/testing"
import { describe, expect, it, vi } from "vitest"

import { historyEventToDoorEvent, syncRingHistory } from "./history-sync"
import { tempRepository } from "./testing/fixtures"

const event = (id: string, type: string, timestamp: number): HistoryEvent =>
  historyEventSchema.parse({ id, type: "history_events", attributes: { event_type: type, timestamp } })

describe("historyEventToDoorEvent", () => {
  it("maps ding, motion sub types, and on_demand with ring_history provenance", () => {
    const now = new Date(0)
    const input = { clientId: "c", deviceId: "d", now }
    expect(historyEventToDoorEvent(event("h1", "ding", 5), input)).toMatchObject({
      type: "ding",
      provenance: "ring_history",
      requestId: "ring-history:h1",
      deviceId: "d",
    })
    expect(historyEventToDoorEvent(event("h2", "motion.human", 5), input)).toMatchObject({ type: "motion", subType: "human" })
    expect(historyEventToDoorEvent(event("h3", "on_demand", 5), input)?.type).toBe("on_demand")
    expect(historyEventToDoorEvent(event("h4", "package.delivered", 5), input)).toBeNull()
  })
})

describe("syncRingHistory", () => {
  it("saves new events once, dedupes on the event id, and counts skips", async () => {
    const repository = await tempRepository()
    const historyEventsAll = vi.fn(async () => [
      event("h1", "ding", 2_000),
      event("h2", "motion.human", 2_100),
      event("h3", "brand.new_type", 2_200),
    ])
    const ring = {
      devices: vi.fn(async () => ({ data: [{ id: "dev1", type: "devices" as const, attributes: { name: "Front Door" } }] })),
      historyEventsAll,
    }
    const input = { ring, repository, clientId: "cli_1", sinceMs: 1_000, now: new Date(3_000), pageDelayMs: 0 }
    const first = await syncRingHistory(input)
    expect(first).toEqual({ devices: 1, fetched: 3, saved: 2, alreadyStored: 0, skippedUnknownType: 1, sinceMs: 1_000 })
    expect(historyEventsAll).toHaveBeenCalledWith("dev1", {}, 20, { sinceMs: 1_000, pageDelayMs: 0 })
    const second = await syncRingHistory(input)
    expect(second).toMatchObject({ saved: 0, alreadyStored: 2 })
    expect(await repository.events.byClient("cli_1")).toHaveLength(2)
  })
})

describe("historyEventToDoorEvent with the real Ring history page", () => {
  it("maps live on_demand events with epoch ms start to ISO times and the source device", () => {
    const events = historyDocumentSchema.parse(PLAYGROUND_FIXTURES.historyEvents).data
    const input = { clientId: "cli_1", deviceId: "fallback", now: new Date("2026-10-22T12:00:00Z") }
    const mapped = events.map((event) => historyEventToDoorEvent(event, input))
    expect(mapped).toHaveLength(3)
    expect(mapped[0]).toMatchObject({
      type: "on_demand",
      provenance: "ring_history",
      deviceId: PLAYGROUND_DEVICE_ID,
      timestampMs: 1792629988552,
      at: new Date(1792629988552).toISOString(),
    })
    for (const door of mapped) expect(door?.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})
