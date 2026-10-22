import { describe, expect, it } from "vitest"

import { historyPagePath } from "./client-support"
import { ENDPOINTS } from "./endpoints"
import {
  PLAYGROUND_DEVICE_ID,
  PLAYGROUND_FIXTURES,
  PLAYGROUND_MANIFEST,
  playgroundRequest,
} from "./fixtures/playground"
import {
  deviceCapabilitiesDocumentSchema,
  deviceConfigurationsDocumentSchema,
  deviceListDocumentSchema,
  deviceLocationDocumentSchema,
  deviceStatusDocumentSchema,
  errorDocumentSchema,
  historyDocumentSchema,
  historyEventDeviceId,
  historyEventTimeIso,
  historyEventTimeMs,
  knownIncludedResourceSchema,
  userDocumentSchema,
} from "./types"

/**
 * Every real Ring Playground response captured on 22 October 2026 must
 * parse, unknown keys must survive, and a genuinely malformed payload must
 * still fail on the fields VisitProof depends on.
 */

const clone = <T>(value: T): T => structuredClone(value)
const { status, capabilities, configurations, location, history, historyEvents, devices } = PLAYGROUND_FIXTURES

describe("real Playground fixtures parse", () => {
  it("parses the device status with null fields and keeps reported_at", () => {
    const doc = deviceStatusDocumentSchema.parse(status)
    expect(doc.data.type).toBe("device-status")
    expect(doc.data.attributes).toMatchObject({ online: true, state: null, reported_at: "2026-10-22T00:37:53Z" })
    expect(doc.data.attributes.audio?.snooze).toEqual({ active: null, until: null })
    expect(doc).toHaveProperty("meta.time")
  })

  it("parses capabilities where most sensors are null", () => {
    const doc = deviceCapabilitiesDocumentSchema.parse(capabilities)
    expect(doc.data.type).toBe("device-capabilities")
    expect(doc.data.attributes.motion_detection?.configurations).toEqual(["enabled", "motion_zones"])
    expect(doc.data.attributes.flood_detection).toBeNull()
    expect(doc.data.attributes.video?.codecs).toEqual(["AVC"])
    expect(doc.data).toHaveProperty("relationships.configurations.links.related")
  })

  it("parses configurations with motion, zones, and end to end encryption", () => {
    const doc = deviceConfigurationsDocumentSchema.parse(configurations)
    const attributes = doc.data.attributes
    expect(doc.data.type).toBe("device-configurations")
    expect(attributes.motion_detection?.enabled).toBe("on")
    expect(attributes.motion_detection?.motion_zones).toHaveLength(1)
    expect(attributes.e2e_encryption?.enabled).toBe(false)
    expect(attributes.audio).toMatchObject({ volume: 11, customizable_slots: null })
    expect(attributes.image_enhancements).toHaveProperty("hdr", "off")
  })

  it("parses the location", () => {
    const doc = deviceLocationDocumentSchema.parse(location)
    expect(doc.data).toMatchObject({ type: "locations", attributes: { country: "US", state: "CA" } })
  })

  it("parses users/me, devices, and devices with every include as known resources", () => {
    expect(userDocumentSchema.parse(PLAYGROUND_FIXTURES.me).data.type).toBe("users")
    const plain = deviceListDocumentSchema.parse(PLAYGROUND_FIXTURES.devicesNoInclude)
    expect(plain.data[0]?.id).toBe(PLAYGROUND_DEVICE_ID)
    expect(plain.included).toBeUndefined()
    const doc = deviceListDocumentSchema.parse(devices)
    expect(doc.data[0]?.attributes).toMatchObject({ name: "Playground Device" })
    expect(doc.included?.map((resource) => resource.type).sort()).toEqual([
      "device-capabilities",
      "device-configurations",
      "device-status",
      "locations",
    ])
    for (const resource of doc.included ?? []) {
      expect(knownIncludedResourceSchema.safeParse(resource).success).toBe(true)
    }
  })

  it("parses the empty history page and the subscriptions 422 error document", () => {
    expect(historyDocumentSchema.parse(history).data).toEqual([])
    expect(errorDocumentSchema.parse(PLAYGROUND_FIXTURES.subscriptions422).errors[0]?.detail).toBe(
      "Unable to process subscription request for this user"
    )
  })

  it("lists every fixture file in the manifest with its capture time", () => {
    expect(PLAYGROUND_MANIFEST.files).toEqual(Object.keys(PLAYGROUND_MANIFEST.requests))
    expect(PLAYGROUND_MANIFEST.files).toHaveLength(Object.keys(PLAYGROUND_FIXTURES).length)
    expect(Date.parse(PLAYGROUND_MANIFEST.capturedAt)).toBeGreaterThan(Date.parse("2026-10-22T00:00:00Z"))
  })
})

describe("malformed payloads still fail", () => {
  it("rejects a status with a non boolean online or a bad reported_at", () => {
    const badOnline = clone(status) as { data: { attributes: Record<string, unknown> } }
    badOnline.data.attributes.online = "yes"
    expect(deviceStatusDocumentSchema.safeParse(badOnline).success).toBe(false)
    const badTime = clone(status) as { data: { attributes: Record<string, unknown> } }
    badTime.data.attributes.reported_at = "yesterday"
    expect(deviceStatusDocumentSchema.safeParse(badTime).success).toBe(false)
  })

  it("rejects the old guessed type name", () => {
    const renamed = clone(status) as { data: { type: string } }
    renamed.data.type = "device_status"
    expect(deviceStatusDocumentSchema.safeParse(renamed).success).toBe(false)
  })

  it("rejects configurations with a non boolean encryption flag or an out of range zone", () => {
    type Config = { data: { attributes: { e2e_encryption: { enabled: unknown }; motion_detection: { motion_zones: { vertices: { x: number }[] }[] } } } }
    const badEncryption = clone(configurations) as Config
    badEncryption.data.attributes.e2e_encryption.enabled = "no"
    expect(deviceConfigurationsDocumentSchema.safeParse(badEncryption).success).toBe(false)
    const badZone = clone(configurations) as Config
    badZone.data.attributes.motion_detection.motion_zones[0]!.vertices[0]!.x = 2
    expect(deviceConfigurationsDocumentSchema.safeParse(badZone).success).toBe(false)
  })

  it("rejects capabilities with a string where a list belongs, and a location without a country", () => {
    const badCodecs = clone(capabilities) as { data: { attributes: { video: { codecs: unknown } } } }
    badCodecs.data.attributes.video.codecs = "AVC"
    expect(deviceCapabilitiesDocumentSchema.safeParse(badCodecs).success).toBe(false)
    const noCountry = clone(location) as { data: { attributes: Record<string, unknown> } }
    delete noCountry.data.attributes.country
    expect(deviceLocationDocumentSchema.safeParse(noCountry).success).toBe(false)
  })

  it("rejects a history event without a timestamp", () => {
    const page = { data: [{ id: "h1", type: "history_events", attributes: { event_type: "ding" } }] }
    expect(historyDocumentSchema.safeParse(page).success).toBe(false)
  })
})

describe("live history events (history-events.json)", () => {
  it("parses the real page: 3 on_demand events with epoch ms start and end", () => {
    const page = historyDocumentSchema.parse(historyEvents)
    expect(page.data).toHaveLength(3)
    expect(page.links).toBeUndefined()
    for (const event of page.data) {
      expect(event.type).toBe("history-events")
      expect(event.attributes.event_type).toBe("on_demand")
      expect(event.attributes.is_third_party_reviewed).toBe(true)
      expect(typeof event.attributes.start).toBe("number")
      expect(event.attributes.timestamp).toBeUndefined()
      expect(historyEventDeviceId(event)).toBe(PLAYGROUND_DEVICE_ID)
      expect(event.relationships?.cv_detections?.data).toEqual([])
    }
  })

  it("converts epoch ms start to ISO 8601", () => {
    const [first] = historyDocumentSchema.parse(historyEvents).data
    expect(first && historyEventTimeMs(first)).toBe(1792629988552)
    expect(first && historyEventTimeIso(first)).toBe(new Date(1792629988552).toISOString())
    expect(first && historyEventTimeIso(first)).toMatch(/^2026-10-2\dT/)
  })

  it("still accepts the documented shape and an ISO start", () => {
    const documented = { data: [{ id: "h1", type: "history_events", attributes: { event_type: "ding", timestamp: 5, device_id: "d1" } }] }
    const [event] = historyDocumentSchema.parse(documented).data
    expect(event && historyEventTimeMs(event)).toBe(5)
    expect(event && historyEventDeviceId(event)).toBe("d1")
    const iso = { data: [{ id: "h2", type: "history-events", attributes: { event_type: "ding", start: "2026-10-22T00:00:00Z" } }] }
    const [isoEvent] = historyDocumentSchema.parse(iso).data
    expect(isoEvent && historyEventTimeIso(isoEvent)).toBe("2026-10-22T00:00:00.000Z")
  })

  it("rejects an unknown resource type and an unparseable start", () => {
    const wrongType = { data: [{ id: "h1", type: "events", attributes: { event_type: "ding", start: 1 } }] }
    expect(historyDocumentSchema.safeParse(wrongType).success).toBe(false)
    const badStart = { data: [{ id: "h1", type: "history-events", attributes: { event_type: "ding", start: "soon" } }] }
    expect(historyDocumentSchema.safeParse(badStart).success).toBe(false)
  })
})

describe("history URL", () => {
  it("matches the request path verified on the Playground", () => {
    expect(historyPagePath(PLAYGROUND_DEVICE_ID, {})).toBe(playgroundRequest("history.json").path)
  })

  it("matches the verified path with event_types", () => {
    const [verified] = PLAYGROUND_MANIFEST.requests["history.json"].alsoVerified
    expect(historyPagePath(PLAYGROUND_DEVICE_ID, { eventTypes: ["motion.human", "ding", "on_demand"] })).toBe(verified?.path)
  })

  it("encodes the device id as one path segment", () => {
    expect(ENDPOINTS.historyEvents("a/b c")).toBe("/v1/history/devices/a%2Fb%20c/events")
  })
})
