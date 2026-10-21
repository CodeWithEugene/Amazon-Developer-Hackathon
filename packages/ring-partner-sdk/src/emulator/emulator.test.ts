import { describe, expect, it } from "vitest"

import { parseWebhook, verifyWebhookSignature, extractDeviceId, dedupeKey } from "../webhook"
import { emulatedDeviceCheck, RingEmulator, type WebhookDelivery } from "./emulator"
import { withRedeliveries } from "./redelivery"
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
    // 62 on_time x2, 9 late x2, 5 early x2, 1 double x3, 3 unobservable
    // (2 outages x3 with the restore, 1 encrypted x2), plus the seeded
    // mid-visit animal or other motion.
    const midVisit = replay.visits.flatMap((v) => v.events).filter((e) => e.kind === "motion_animal" || e.kind === "motion_other")
    expect(replay.deliveries.length).toBe(163 + midVisit.length)
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


describe("two-week realism", () => {
  const START = Date.UTC(2026, 8, 15, 0, 0, 0)
  const MIN = 60_000
  const replay = new RingEmulator({ signingKey: KEY }).twoWeeks({ startAt: START })
  const nyTime = (ms: number) =>
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(ms)
  const of = (kind: string) => replay.visits.filter((v) => v.kind === kind)

  it("schedules visits at realistic New York local hours", () => {
    const slots = new Set(replay.visits.map((v) => nyTime(v.scheduledStartAt)))
    expect([...slots].sort()).toEqual(["12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 AM", "9:30 AM"])
    expect(replay.timeZone).toBe("America/New_York")
    expect(replay.visits[0]?.localDate).toBe("2026-09-15")
  })

  it("jitters arrivals and departures without changing any planned outcome", () => {
    const onTime = [...of("on_time"), ...of("double")]
    const offsets = onTime.map((v) => (v.arrivalAt! - v.scheduledStartAt) / MIN)
    expect(new Set(offsets.map((o) => Math.round(o))).size).toBeGreaterThan(5)
    for (const o of offsets) expect(o).toBeGreaterThanOrEqual(-6)
    for (const o of offsets) expect(o).toBeLessThanOrEqual(9)
    for (const v of onTime) expect(v.departureAt!).toBeGreaterThanOrEqual(v.scheduledEndAt - 10 * MIN)
    for (const v of of("late")) expect(v.arrivalAt! - v.scheduledStartAt).toBeGreaterThan(15 * MIN)
    for (const v of of("early")) expect(v.departureAt!).toBeLessThan(v.scheduledEndAt - 10 * MIN)
    for (const v of of("no_show")) expect(v.events).toHaveLength(0)
    expect(of("unobservable").map((v) => v.outage).sort()).toEqual([
      "device_offline",
      "encrypted_device",
      "integration_removed",
    ])
    for (const v of of("unobservable")) {
      const kinds = v.events.map((e) => e.kind)
      if (v.outage === "device_offline") expect(kinds).toEqual(["ding", "device_offline", "device_online"])
      if (v.outage === "integration_removed") {
        expect(kinds).toEqual(["ding", "integration_removed", "integration_added"])
      }
      if (v.outage === "encrypted_device") expect(kinds).toEqual(["ding", "motion_human"])
      const lost = v.events[1]!
      if (v.outage !== "encrypted_device") {
        expect(lost.at).toBe(v.scheduledStartAt + 30 * MIN)
        expect(v.events[2]!.at).toBe(v.scheduledEndAt + 60 * MIN)
      }
    }
  })

  it("reports TAKE encryption only around the encrypted-device visit", () => {
    const encrypted = of("unobservable").find((v) => v.outage === "encrypted_device")!
    const check = (at: number) => emulatedDeviceCheck(replay.visits, encrypted.clientId, at).encryptionState
    expect(check(encrypted.scheduledStartAt)).toBe("take")
    expect(check(encrypted.scheduledEndAt + 60 * MIN)).toBe("take")
    expect(check(encrypted.scheduledStartAt - 61 * MIN)).toBe("clear")
    expect(check(encrypted.scheduledEndAt + 61 * MIN)).toBe("clear")
    expect(emulatedDeviceCheck(replay.visits, "cli_okoro", encrypted.scheduledStartAt).encryptionState).toBe("clear")
  })

  it("emits the integration lifecycle as account-level Ring events", () => {
    const types = replay.deliveries.map((d) => d.envelope.data.type)
    expect(types.filter((t) => t === "app_integration_removed")).toHaveLength(1)
    expect(types.filter((t) => t === "app_integration_added")).toHaveLength(1)
    expect(types.filter((t) => t === "device_online")).toHaveLength(1)
  })

  it("adds occasional mid-visit motion that is never an arrival signal", () => {
    const mid = replay.visits.flatMap((v) =>
      v.events.filter((e) => e.kind === "motion_animal" || e.kind === "motion_other").map((e) => ({ v, e }))
    )
    expect(mid.length).toBeGreaterThan(5)
    for (const { v, e } of mid) {
      expect(e.at).toBeGreaterThan(v.arrivalAt!)
      expect(e.at).toBeLessThan(v.departureAt!)
    }
  })

  it("plans independent EVV behavior: 6 contradicted, 8 missing, none for no-shows", () => {
    const count = (behavior: string) => replay.visits.filter((v) => v.evv.behavior === behavior).length
    expect(count("contradicted")).toBe(6)
    expect(count("missing")).toBe(8)
    expect(count("none")).toBe(4)
    for (const v of replay.visits) {
      if (v.evv.behavior === "normal") expect(Math.abs(v.evv.clockInAt! - v.arrivalAt!)).toBeLessThanOrEqual(4 * MIN)
      if (v.evv.behavior === "contradicted") expect(v.arrivalAt! - v.evv.clockInAt!).toBeGreaterThan(30 * MIN)
      if (v.evv.behavior === "missing") expect(v.evv.clockInAt).toBeNull()
    }
  })

  it("labels every delivery as emulated and uses Ring's id and readable formats", () => {
    const first = replay.deliveries[0]!
    expect(first.headers["x-visitproof-provenance"]).toBe("emulated")
    expect(first.envelope.data.id).toMatch(/^emu_dev_[a-z]+_front_door_(ding|motion)_\d+$/)
    expect(first.envelope.data.attributes.timestamp_readable).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})

describe("withRedeliveries", () => {
  it("resends a few identical deliveries and is deterministic", () => {
    const replay = new RingEmulator({ signingKey: KEY }).twoWeeks({ startAt: Date.UTC(2026, 8, 15) })
    const wire = withRedeliveries(replay.deliveries, { rate: 0.05, seed: "s" })
    expect(wire.length).toBeGreaterThan(replay.deliveries.length)
    const ids = wire.map((d) => d.envelope.meta.request_id)
    expect(new Set(ids).size).toBe(replay.deliveries.length)
    expect(withRedeliveries(replay.deliveries, { rate: 0.05, seed: "s" })).toEqual(wire)
  })
})
