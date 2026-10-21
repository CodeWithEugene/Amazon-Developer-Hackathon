import { createHash } from "node:crypto"

import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent } from "@visitproof/domain"
import type { HistoryEvent, RingClient } from "@visitproof/ring-partner-sdk"

/**
 * "Sync Ring History": pulls history events since consent for every shared
 * device, normalizes them to `DoorEvent`s with provenance `ring_history`
 * (contract C4), dedupes on the Ring event id, and saves them through the
 * repository. Paced at five requests per second (docs/build.md 5.2).
 */

export const HISTORY_PAGE_DELAY_MS = 200
export const HISTORY_MAX_PAGES = 20

export const historyRequestId = (eventId: string): string => `ring-history:${eventId}`

const mapType = (eventType: string): Pick<DoorEvent, "type"> & { subType?: string } | null => {
  if (eventType === "ding") return { type: "ding" }
  if (eventType === "on_demand") return { type: "on_demand" }
  if (eventType.startsWith("motion.")) return { type: "motion", subType: eventType.slice("motion.".length) }
  return null
}

export const historyEventToDoorEvent = (
  event: HistoryEvent,
  input: { readonly clientId: string; readonly deviceId: string; readonly now: Date }
): DoorEvent | null => {
  const mapped = mapType(event.attributes.event_type)
  if (mapped === null) return null
  const nowIso = input.now.toISOString()
  return {
    clientId: input.clientId,
    requestId: historyRequestId(event.id),
    timestampMs: event.attributes.timestamp,
    at: new Date(event.attributes.timestamp).toISOString(),
    ...mapped,
    deviceId: event.attributes.device_id ?? input.deviceId,
    provenance: "ring_history",
    rawPayloadHash: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
    componentIds: [],
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  }
}

export interface HistorySyncResult {
  readonly devices: number
  readonly fetched: number
  readonly saved: number
  readonly alreadyStored: number
  readonly skippedUnknownType: number
  readonly sinceMs: number
}

type HistoryReader = Pick<RingClient, "devices" | "historyEventsAll">

export interface HistorySyncInput {
  readonly ring: HistoryReader
  readonly repository: VisitProofRepository
  readonly clientId: string
  readonly sinceMs: number
  readonly now: Date
  readonly pageDelayMs?: number
}

const fetchAll = async (input: HistorySyncInput) => {
  const devices = await input.ring.devices()
  const perDevice = []
  for (const device of devices.data) {
    const events = await input.ring.historyEventsAll(device.id, {}, HISTORY_MAX_PAGES, {
      sinceMs: input.sinceMs,
      pageDelayMs: input.pageDelayMs ?? HISTORY_PAGE_DELAY_MS,
    })
    perDevice.push({ deviceId: device.id, events })
  }
  return perDevice
}

export const syncRingHistory = async (input: HistorySyncInput): Promise<HistorySyncResult> => {
  const perDevice = await fetchAll(input)
  const stored = await input.repository.events.byClient(input.clientId, { sinceMs: input.sinceMs })
  const known = new Set(stored.map((event) => event.requestId))
  const counts = { fetched: 0, saved: 0, alreadyStored: 0, skippedUnknownType: 0 }
  for (const { deviceId, events } of perDevice) {
    for (const event of events) {
      counts.fetched += 1
      const door = historyEventToDoorEvent(event, { clientId: input.clientId, deviceId, now: input.now })
      if (door === null) counts.skippedUnknownType += 1
      else if (known.has(door.requestId)) counts.alreadyStored += 1
      else {
        await input.repository.events.put(door)
        known.add(door.requestId)
        counts.saved += 1
      }
    }
  }
  return { devices: perDevice.length, sinceMs: input.sinceMs, ...counts }
}
