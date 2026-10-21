import { deviceListDocumentSchema } from "@visitproof/ring-partner-sdk"
import { describe, expect, it } from "vitest"

import { buildDeviceChecks } from "./device-check"

const doc = (overrides: { status?: object; capabilities?: object; configurations?: object } = {}) =>
  deviceListDocumentSchema.parse({
    data: [
      {
        id: "dev1",
        type: "devices",
        attributes: { name: "Front Door", kind: "doorbell", battery_powered: true },
        relationships: { status: { data: { id: "st1", type: "device_status" } } },
      },
    ],
    included: [
      { id: "st1", type: "device_status", attributes: { online: true, encryption_state: "clear", ...overrides.status } },
      { id: "dev1", type: "device_capabilities", attributes: { human_detection: true, ...overrides.capabilities } },
      {
        id: "dev1",
        type: "device_configurations",
        attributes: {
          motion_recording_enabled: true,
          motion_zones: [{ enabled: true, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
          ...overrides.configurations,
        },
      },
      { id: "dev1", type: "device_location", attributes: { country: "US", state: "OH" } },
    ],
  })

describe("buildDeviceChecks", () => {
  it("passes a well configured doorbell on all five items", () => {
    const [check] = buildDeviceChecks(doc())
    expect(check?.items.map((item) => [item.title, item.state])).toEqual([
      ["Online", "pass"],
      ["Motion Recording On", "pass"],
      ["Motion Zone Present", "pass"],
      ["Human Detection Available", "pass"],
      ["Encryption State Known", "pass"],
    ])
    expect(check).toMatchObject({ name: "Front Door", passed: 5, location: "OH, US", batteryPowered: true })
  })

  it("explains failures with where to change them in the Ring app", () => {
    const [check] = buildDeviceChecks(
      doc({
        status: { online: false, encryption_state: "e2ee" },
        configurations: { motion_recording_enabled: false, motion_zones: [] },
        capabilities: { human_detection: false },
      })
    )
    expect(check?.passed).toBe(0)
    for (const item of check?.items ?? []) {
      expect(item.whereToChange).toMatch(/Ring app/)
      expect(item.whyItMatters.length).toBeGreaterThan(20)
    }
  })

  it("marks missing data as unknown instead of passing", () => {
    const [check] = buildDeviceChecks(
      deviceListDocumentSchema.parse({ data: [{ id: "d", type: "devices", attributes: { name: "Side Door" } }] })
    )
    expect(new Set(check?.items.map((item) => item.state))).toEqual(new Set(["unknown"]))
  })

  it("uses no dashes in user facing copy", () => {
    const text = buildDeviceChecks(doc({ status: { encryption_state: "take" } }))
      .flatMap((check) => check.items)
      .flatMap((item) => [item.title, item.observed, item.whyItMatters, item.whereToChange])
      .join(" ")
    expect(text).not.toMatch(/[–—]/)
  })
})
