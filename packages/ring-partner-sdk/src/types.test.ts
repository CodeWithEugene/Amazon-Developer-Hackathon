import { describe, expect, it } from "vitest"

import {
  deviceListDocumentSchema,
  errorDocumentSchema,
  historyDocumentSchema,
  isKnownValue,
  KNOWN_HISTORY_EVENT_TYPES,
  tokenResponseSchema,
  webhookEnvelopeSchema,
  webhookEventTypeSchema,
} from "./types"

const envelope = {
  meta: {
    version: "1.1",
    time: "2026-02-13T13:39:57.200Z",
    request_id: "2ad45ade-0000-4000-8000-000000000000",
    account_id: "ava1.ring.account.XXX",
  },
  data: {
    id: "dev1_motion_1786715596787",
    type: "motion_detected",
    attributes: {
      source: "dev1",
      source_type: "devices",
      timestamp: 1786715596787,
      timestamp_readable: "2026-08-14 08:53:16",
      sub_type: "human",
      component_ids: ["0"],
    },
    relationships: { devices: { links: { self: "/v1/devices/dev1" } } },
  },
}

describe("webhookEnvelopeSchema", () => {
  it("parses the documented v1.1 motion payload", () => {
    const parsed = webhookEnvelopeSchema.parse(envelope)

    expect(parsed.data.type).toBe("motion_detected")
    if (parsed.data.type === "motion_detected") {
      expect(parsed.data.attributes.sub_type).toBe("human")
    }
  })

  it("rejects an unknown event type", () => {
    const result = webhookEnvelopeSchema.safeParse({
      ...envelope,
      data: { ...envelope.data, type: "motion_started" },
    })

    expect(result.success).toBe(false)
  })

  it("accepts every union member type name", () => {
    expect(webhookEventTypeSchema.options).toContain("contact_sensor_faulted")
    expect(webhookEventTypeSchema.options).toContain("subscription_activated")
  })
})

describe("tokenResponseSchema", () => {
  it("defaults token_type to Bearer", () => {
    const token = tokenResponseSchema.parse({
      access_token: "a",
      refresh_token: "r",
      scope: "read",
      expires_in: 14400,
    })

    expect(token.token_type).toBe("Bearer")
  })
})

describe("errorDocumentSchema", () => {
  it("requires at least one error", () => {
    expect(errorDocumentSchema.safeParse({ errors: [] }).success).toBe(false)
  })
})

describe("open enums", () => {
  it("keeps a history page with an unknown event type", () => {
    const page = historyDocumentSchema.parse({
      data: [
        { id: "h1", type: "history_events", attributes: { event_type: "ding", timestamp: 1 } },
        { id: "h2", type: "history_events", attributes: { event_type: "package.delivered", timestamp: 2 } },
      ],
    })
    expect(page.data.map((event) => event.attributes.event_type)).toEqual(["ding", "package.delivered"])
    expect(isKnownValue(KNOWN_HISTORY_EVENT_TYPES, "package.delivered")).toBe(false)
    expect(isKnownValue(KNOWN_HISTORY_EVENT_TYPES, "ding")).toBe(true)
  })

  it("keeps devices with unknown kinds, encryption states, and included types", () => {
    const doc = deviceListDocumentSchema.parse({
      data: [{ id: "d1", type: "devices", attributes: { name: "Front Door", kind: "intercom" } }],
      included: [
        { id: "d1", type: "device_status", attributes: { online: true, encryption_state: "future_mode" } },
        { id: "d1", type: "device_components", attributes: { count: 2 } },
      ],
    })
    expect(doc.data[0]?.attributes.kind).toBe("intercom")
    expect(doc.included).toHaveLength(2)
  })
})
