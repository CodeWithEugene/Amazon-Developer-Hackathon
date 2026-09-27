import { describe, expect, it } from "vitest"

import { parseWebhook, verifyWebhookSignature, extractDeviceId, dedupeKey } from "../webhook"
import { RingEmulator, type WebhookDelivery } from "./emulator"
import { SCENARIOS, TWO_WEEKS_CLIENTS, type ScenarioName } from "./scenarios"

const KEY = "emu-signing-key"
const DAY = 24 * 60 * 60 * 1000

const roundTrip = (delivery: WebhookDelivery) => {
  expect(verifyWebhookSignature(delivery.rawBody, delivery.header, KEY)).toBe(true)
  return parseWebhook(delivery.rawBody)
}

describe("RingEmulator primitives", () => {
  const emu = new RingEmulator({ signingKey: KEY })

  it("signs a ding that round-trips through the verifier", () => {
    const delivery = emu.ding({ deviceId: "dev1", accountId: "acc1" })
    const envelope = roundTrip(delivery)
    expect(envelope.data.type).toBe("button_press")
    expect(envelope.meta.account_id).toBe("acc1")
    expect(extractDeviceId(envelope)).toBe("dev1")
  })

  it("signs human and vehicle motion with the right sub_type", () => {
    const human = roundTrip(emu.motion({ deviceId: "dev1" }))
    const vehicle = roundTrip(emu.motion({ deviceId: "dev1" }, "vehicle"))
    expect(human.data.type).toBe("motion_detected")
    if (human.data.type === "motion_detected") expect(human.data.attributes.sub_type).toBe("human")
    if (vehicle.data.type === "motion_detected") expect(vehicle.data.attributes.sub_type).toBe("vehicle")
  })

  it("never repeats a request id or timestamp (replay-safe)", () => {
    const emu2 = new RingEmulator({ signingKey: KEY })
    const deliveries = [
      ...emu2.scenario("on_time", { deviceId: "dev1" }),
      ...emu2.scenario("on_time", { deviceId: "dev1" }),
    ]
    const ids = deliveries.map(d => dedupeKey(d.envelope))
    expect(new Set(ids).size).toBe(ids.length)
    const times = deliveries.map(d => d.envelope.data.attributes.timestamp)
    expect(new Set(times).size).toBe(times.length)
    for (const delivery of deliveries) expect(verifyWebhookSignature(delivery.rawBody, delivery.header, KEY)).toBe(true)
  })

  it("bumps an explicitly backwards timestamp so it stays unique", () => {
    const emu2 = new RingEmulator({ signingKey: KEY })
    const first = emu2.ding({ deviceId: "dev1", at: 2_000 })
    const second = emu2.ding({ deviceId: "dev1", at: 1_000 })
    expect(second.envelope.data.attributes.timestamp).toBe(first.envelope.data.attributes.timestamp + 1)
    expect(verifyWebhookSignature(second.rawBody, second.header, KEY)).toBe(true)
  })

  it("rejects an unknown scenario and a missing key", () => {
    expect(() => emu.scenario("nonsense", { deviceId: "dev1" })).toThrow(RangeError)
    expect(() => new RingEmulator({ signingKey: "" })).toThrow(RangeError)
  })
})

describe("RingEmulator scenarios", () => {
  const emu = new RingEmulator({ signingKey: KEY })
  const START = Date.UTC(2026, 9, 5, 14, 0, 0)

  const names = Object.keys(SCENARIOS) as ScenarioName[]
  const aliases = ["missed", "no_show_day", "multiple_caregivers", "unobservable"]

  it("has a script for every canonical scenario and alias", () => {
    expect(names.length).toBeGreaterThanOrEqual(12)
    for (const name of [...names, ...aliases]) {
      expect(emu.script(name).steps.length).toBeGreaterThanOrEqual(0)
    }
  })

  it("every delivery of every scenario verifies and parses", () => {
    for (const name of names) {
      for (const delivery of emu.scenario(name, { deviceId: "dev1", accountId: "acc1", visitStartAt: START })) {
        roundTrip(delivery)
      }
    }
  })

  it("no_show produces no deliveries; on_time produces arrival and departure", () => {
    expect(emu.scenario("no_show", { deviceId: "dev1", visitStartAt: START })).toHaveLength(0)
    const onTime = emu.scenario("on_time", { deviceId: "dev1", visitStartAt: START })
    expect(onTime.map(d => d.envelope.data.type)).toEqual([
      "button_press",
      "motion_detected",
      "motion_detected",
    ])
  })

  it("aliases map onto canonical scenarios", () => {
    expect(emu.script("missed").name).toBe("no_show")
    expect(emu.script("multiple_caregivers").name).toBe("double_visitor")
    expect(emu.script("unobservable").name).toBe("device_offline_mid_visit")
    expect(emu.script("no_show_day").name).toBe("no_show")
  })
})

describe("two-week replay dataset", () => {
  const emu = new RingEmulator({ signingKey: KEY })
  const START = Date.UTC(2026, 8, 14, 0, 0, 0)

  it("covers three clients and exactly 84 scripted visits", () => {
    expect(TWO_WEEKS_CLIENTS).toHaveLength(3)
    for (const client of TWO_WEEKS_CLIENTS) expect(client.visits).toHaveLength(28)
  })

  it("matches the demo dataset counts (62/9/4/5/3/1)", () => {
    const replay = emu.twoWeeks({ startAt: START })
    expect(replay.visits).toHaveLength(84)
    const count = (kind: string) => replay.visits.filter(v => v.kind === kind).length
    expect(count("on_time")).toBe(62)
    expect(count("late")).toBe(9)
    expect(count("no_show")).toBe(4)
    expect(count("early")).toBe(5)
    expect(count("unobservable")).toBe(3)
    expect(count("double")).toBe(1)
  })

  it("expects the double-visitor visit to complete, not go ambiguous", () => {
    // Vehicle motion is not an arrival signal, so the ding is the only
    // arrival candidate (single cluster, deterministic choice); the trailing
    // human motion is the departure. The engine completes the visit.
    const replay = emu.twoWeeks({ startAt: START })
    const double = replay.visits.find((v) => v.kind === "double")
    expect(double?.expected).toBe("completed")
  })

  it("every delivery verifies, parses, and is ordered oldest first", () => {
    const replay = emu.twoWeeks({ startAt: START })
    // 62 on_time x2, 9 late x2, 5 early x2, 3 unobservable x2, 1 double x3
    expect(replay.deliveries.length).toBe(161)
    let previous = 0
    const requestIds = new Set<string>()
    for (const delivery of replay.deliveries) {
      roundTrip(delivery)
      expect(delivery.at).toBeGreaterThanOrEqual(previous)
      previous = delivery.at
      requestIds.add(dedupeKey(delivery.envelope))
    }
    expect(requestIds.size).toBe(replay.deliveries.length)
  })

  it("is deterministic for a fixed start and spans 14 days", () => {
    const one = new RingEmulator({ signingKey: KEY, requestId: () => "fixed" }).twoWeeks({ startAt: START })
    const two = new RingEmulator({ signingKey: KEY, requestId: () => "fixed" }).twoWeeks({ startAt: START })
    expect(one.deliveries.map(d => Buffer.from(d.rawBody).toString("utf8")))
      .toEqual(two.deliveries.map(d => Buffer.from(d.rawBody).toString("utf8")))
    expect(one.endAt - one.startAt).toBeLessThanOrEqual(14 * DAY + 2 * 60 * 60 * 1000)
  })

  it("rejects an invalid start", () => {
    expect(() => emu.twoWeeks({ startAt: 0 })).toThrow(RangeError)
  })
})
