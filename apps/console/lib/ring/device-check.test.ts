import { deviceListDocumentSchema } from "@visitproof/ring-partner-sdk"
import { PLAYGROUND_DEVICE_ID, PLAYGROUND_FIXTURES } from "@visitproof/ring-partner-sdk/testing"
import { describe, expect, it } from "vitest"

import { buildDeviceChecks, deviceCheckSummary } from "./device-check"

/** The real Playground document, with attribute overrides per included type. */
const realDoc = (overrides: Readonly<Record<string, object>> = {}) => {
  const raw = structuredClone(PLAYGROUND_FIXTURES.devices) as {
    data: unknown[]
    included: { type: string; attributes: Record<string, unknown> }[]
  }
  return deviceListDocumentSchema.parse({
    ...raw,
    included: raw.included.map((resource) => ({
      ...resource,
      attributes: { ...resource.attributes, ...overrides[resource.type] },
    })),
  })
}

describe("buildDeviceChecks on the real Ring Playground fixtures", () => {
  it("passes 4 of 4 required checks plus the informational human detection item", () => {
    const [check] = buildDeviceChecks(realDoc(), { timeZone: "UTC" })
    expect(check).toMatchObject({ deviceId: PLAYGROUND_DEVICE_ID, name: "Playground Device", location: "CA, US", passed: 4, required: 4 })
    expect(check?.items.map((item) => [item.title, item.state, item.required])).toEqual([
      ["Online", "pass", true],
      ["Motion Recording On", "pass", true],
      ["Motion Zone Present", "pass", true],
      ["Encryption State Known", "pass", true],
      ["Human Detection", "info", false],
    ])
    expect(deviceCheckSummary(check!)).toBe("4 of 4 required checks passing")
  })

  it("shows when Ring last reported the status", () => {
    const [check] = buildDeviceChecks(realDoc(), { timeZone: "America/New_York" })
    expect(check?.items[0]?.observed).toBe("The doorbell is connected. Last reported by Ring: Oct 21, 8:37 PM ET.")
  })

  it("explains standard encryption and the single motion zone", () => {
    const [check] = buildDeviceChecks(realDoc())
    const byId = new Map(check?.items.map((item) => [item.id, item]))
    expect(byId.get("encryption_known")?.observed).toMatch(/^Standard encryption\. End to end encryption is off/)
    expect(byId.get("motion_zone")?.observed).toBe("1 active motion zone.")
    expect(byId.get("human_detection")?.observed).toMatch(/human sub type/)
  })
})

describe("buildDeviceChecks failures and gaps", () => {
  it("fails offline, motion off, no zones, and end to end encryption", () => {
    const [check] = buildDeviceChecks(
      realDoc({
        "device-status": { online: false },
        "device-configurations": { motion_detection: { enabled: "off", motion_zones: [] }, e2e_encryption: { enabled: true } },
      })
    )
    expect(check?.passed).toBe(0)
    expect(check?.items.filter((item) => item.required).map((item) => item.state)).toEqual(["fail", "fail", "fail", "fail"])
    for (const item of check?.items ?? []) {
      expect(item.whereToChange).toMatch(/Ring app/)
      expect(item.whyItMatters.length).toBeGreaterThan(20)
    }
  })

  it("marks missing data as unknown instead of passing, and keeps human detection informational", () => {
    const [check] = buildDeviceChecks(
      deviceListDocumentSchema.parse({ data: [{ id: "d", type: "devices", attributes: { name: "Side Door" } }] })
    )
    expect(check?.items.filter((item) => item.required).map((item) => item.state)).toEqual(["unknown", "unknown", "unknown", "unknown"])
    expect(check?.items.at(-1)?.state).toBe("info")
    expect(check).toMatchObject({ passed: 0, required: 4 })
  })

  it("treats an unexpected motion setting as unknown", () => {
    const [check] = buildDeviceChecks(realDoc({ "device-configurations": { motion_detection: { enabled: "scheduled", motion_zones: [] } } }))
    expect(check?.items[1]?.state).toBe("unknown")
  })

  it("uses no dashes in user facing copy", () => {
    const text = buildDeviceChecks(realDoc({ "device-configurations": { e2e_encryption: { enabled: true } } }))
      .flatMap((check) => check.items)
      .flatMap((item) => [item.title, item.observed, item.whyItMatters, item.whereToChange])
      .join(" ")
    expect(text).not.toMatch(/[–—]/)
  })
})
