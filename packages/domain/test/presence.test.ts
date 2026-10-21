import { describe, expect, it } from "vitest"

import {
  arrivalCandidates,
  assessObservability,
  assessVisitObservability,
  assignVisit,
  chooseArrival,
  classifyVisit,
  clusterCandidates,
  detectDeparture,
  evaluateDeparture,
  eventsForVisit,
  findVisitWindow,
  isTerminalStatus,
  lifecycleDuring,
  mergeObservability,
  ruleJudge,
  type ArrivalCandidate,
  type ArrivalJudge,
} from "../src/presence"
import type { Device } from "../src/types"
import { at, ding, END, event, human, MIN, START, T, visit } from "./helpers"

const S = Date.parse(START)
const cand = (minutes: number, extra: Partial<ArrivalCandidate> = {}): ArrivalCandidate => ({
  at: at(START, minutes),
  eventId: `e${minutes}`,
  kind: "ding",
  ...extra,
})

describe("arrivalCandidates", () => {
  it("keeps ding and human motion in [start - 30, min(start + 60, end)] and flags vehicles", () => {
    const events = [
      ding(at(START, -31)),
      event(at(START, -1), "motion", "vehicle"),
      human(at(START, 0)),
      event(at(START, 1), "motion", "animal"),
      ding(at(START, 61)),
    ]
    const candidates = arrivalCandidates(visit(), events)
    expect(candidates.map((c) => [c.at, c.kind, c.precededByVehicle ?? false])).toEqual([
      [at(START, 0), "human_motion", true],
    ])
    const short = visit({ scheduledEnd: at(START, 20) })
    expect(arrivalCandidates(short, [ding(at(START, 25))])).toEqual([])
  })
})

describe("clusterCandidates", () => {
  it("chains candidates at most 5 minutes apart", () => {
    const clusters = clusterCandidates([cand(8), cand(0), cand(4), cand(20)])
    expect(clusters.map((c) => c.map((x) => x.eventId))).toEqual([["e0", "e4", "e8"], ["e20"]])
    expect(clusterCandidates([])).toEqual([])
  })
})

describe("ruleJudge", () => {
  it("is labeled rule and returns null with no candidates", () => {
    expect(ruleJudge.kind).toBe("rule")
    expect(ruleJudge.chooseArrival({ scheduledStart: START, candidates: [] })).toBeNull()
  })

  it("prefers the cluster nearest the expected arrival, with margin-based confidence", () => {
    const clear = ruleJudge.chooseArrival({ scheduledStart: START, candidates: [cand(-25), cand(2)] })
    expect(clear).toEqual({ at: at(START, 2), confidence: 0.85 })
    const close = ruleJudge.chooseArrival({ scheduledStart: START, candidates: [cand(-15), cand(10)] })
    expect(close?.at).toBe(at(START, 10))
    expect(close!.confidence).toBeLessThan(0.7)
    expect(ruleJudge.chooseArrival({ scheduledStart: START, candidates: [cand(3)] })).toEqual({
      at: at(START, 3),
      confidence: 0.85,
    })
  })

  it("penalizes delivery-like clusters and honors the usual arrival offset", () => {
    const delivery = ruleJudge.chooseArrival({
      scheduledStart: START,
      candidates: [cand(-2, { precededByVehicle: true }), cand(12)],
    })
    expect(delivery?.at).toBe(at(START, 12))
    const usual = ruleJudge.chooseArrival({
      scheduledStart: START,
      candidates: [cand(-25), cand(2)],
      caregiverUsualArrivalOffsetMin: -25,
    })
    expect(usual?.at).toBe(at(START, -25))
  })
})

describe("chooseArrival", () => {
  it("returns none, a late rule arrival, or the earliest of nearby clusters", () => {
    expect(chooseArrival(visit(), []).outcome).toBe("none")
    const late = chooseArrival(visit(), [cand(20), cand(40)])
    expect(late).toMatchObject({ outcome: "chosen", method: "rule", arrival: { at: at(START, 20) } })
    const near = chooseArrival(visit(), [cand(-10), cand(5)])
    expect(near).toMatchObject({ outcome: "chosen", arrival: { at: at(START, -10), source: "rule" } })
  })

  it("maps a judge pick to the earliest candidate of its cluster", () => {
    const judge: ArrivalJudge = { kind: "jev", chooseArrival: () => ({ at: at(START, 4), confidence: 0.8 }) }
    const result = chooseArrival(visit(), [cand(-25), cand(2), cand(4)], { judge })
    expect(result).toMatchObject({ outcome: "chosen", method: "jev", arrival: { at: at(START, 2), source: "jev" } })
  })

  it("is ambiguous when the judge declines or picks an unknown time", () => {
    const none: ArrivalJudge = { chooseArrival: () => null }
    expect(chooseArrival(visit(), [cand(-25), cand(2)], { judge: none }).outcome).toBe("ambiguous")
    const stray: ArrivalJudge = { chooseArrival: () => ({ at: at(START, 99), confidence: 0.99 }) }
    expect(chooseArrival(visit(), [cand(-25), cand(2)], { judge: stray }).outcome).toBe("ambiguous")
  })
})

describe("evaluateDeparture and detectDeparture", () => {
  const arrived = visit({ arrival: { at: START, source: "rule" } })

  it("is pending without an arrival or before the quiet period", () => {
    expect(evaluateDeparture({ visit: visit(), events: [], tolerances: T, now: new Date(S) }).state).toBe("pending")
    const events = [human(at(END, 2))]
    expect(evaluateDeparture({ visit: arrived, events, tolerances: T, now: new Date(Date.parse(END) + 5 * MIN) })).toMatchObject({
      state: "pending",
      provisional: { at: at(END, 2) },
    })
  })

  it("is not observed when nothing follows the arrival by the window end", () => {
    const now = new Date(Date.parse(END) + 61 * MIN)
    expect(evaluateDeparture({ visit: arrived, events: [], tolerances: T, now }).state).toBe("not_observed")
  })

  it("wraps into the legacy detectDeparture shape and limits events to the window", () => {
    const events = [human(at(END, 2)), human(at(END, 200))]
    expect(detectDeparture(arrived, events, 10, new Date(Date.parse(END) + 15 * MIN))).toMatchObject({
      at: at(END, 2),
      source: "rule",
    })
    expect(detectDeparture(arrived, events, 10, new Date(Date.parse(END) + 5 * MIN))).toBe("not_observed")
  })
})

describe("classifyVisit and isTerminalStatus", () => {
  it("walks the status machine", () => {
    const v = visit()
    expect(classifyVisit(v, new Date(S - 31 * MIN), T)).toBe("scheduled")
    expect(classifyVisit(v, new Date(S + 44 * MIN), T)).toBe("awaiting_arrival")
    expect(classifyVisit(v, new Date(S + 45 * MIN), T)).toBe("no_show")
    const arrived = visit({ arrival: { at: START, source: "rule" } })
    expect(classifyVisit(arrived, new Date(S + 60 * MIN), T)).toBe("in_progress")
    expect(classifyVisit(arrived, new Date(Date.parse(END) + 61 * MIN), T)).toBe("departure_not_observed")
    expect(classifyVisit({ ...arrived, departure: { at: END, source: "rule" } }, new Date(S), T)).toBe("completed")
    expect(classifyVisit({ ...arrived, departure: { at: at(START, 30), source: "rule" } }, new Date(S), T)).toBe(
      "early_departure"
    )
    expect(
      classifyVisit(visit({ observability: { state: "unobservable", reasons: [] } }), new Date(S), T)
    ).toBe("unobservable")
    expect(isTerminalStatus("no_show")).toBe(true)
    expect(isTerminalStatus("in_progress")).toBe(false)
  })
})

describe("visit windows", () => {
  it("matches events within [start - 60, end + 60] for the right client", () => {
    const v = visit()
    expect(findVisitWindow({ id: "c1" }, ding(at(START, -60)), [v])).toBe(v)
    expect(findVisitWindow({ id: "c1" }, ding(at(END, 60)), [v])).toBe(v)
    expect(findVisitWindow({ id: "c1" }, ding(at(START, -61)), [v])).toBeNull()
    expect(findVisitWindow({ id: "c2" }, ding(START), [v])).toBeNull()
  })

  it("breaks ties between overlapping schedules by the nearest start or end", () => {
    const a = visit({ id: "a", scheduledStart: at(START, 0), scheduledEnd: at(START, 120) })
    const b = visit({ id: "b", scheduledStart: at(START, 60), scheduledEnd: at(START, 180) })
    expect(assignVisit(ding(at(START, 62)), [a, b])?.id).toBe("b")
    expect(assignVisit(human(at(START, 115)), [a, b])?.id).toBe("a")
    const twin = visit({ id: "twin" })
    expect(assignVisit(ding(START), [visit(), twin])?.id).toBe("twin")
    expect(eventsForVisit(a, [ding(START)], [])).toHaveLength(1)
  })
})

const frontDoor = (overrides: Partial<Device> = {}): Device => ({
  createdAt: START,
  updatedAt: START,
  version: 1,
  clientId: "c1",
  ringDeviceId: "d1",
  name: "Front Door",
  online: true,
  capabilities: { motionDetection: true, humanDetection: true, liveView: true, snapshots: true, battery: false },
  motionRecordingEnabled: true,
  hasMotionZone: true,
  role: "front_door",
  ...overrides,
})

describe("assessObservability", () => {
  it("is observable when the front door is healthy and when devices are unknown", () => {
    expect(assessObservability({ devices: [frontDoor()] })).toEqual({ state: "observable", reasons: [] })
    expect(assessObservability({})).toEqual({ state: "observable", reasons: [] })
  })

  it("flags every EARS 8 reason once", () => {
    const result = assessObservability({
      devices: [frontDoor({ online: false, motionRecordingEnabled: false, hasMotionZone: false })],
      encryptionState: "e2ee",
      integrationStatus: "removed",
      integrationRemovedDuringWindow: true,
      offlineDuringWindow: true,
      ringLinkStatus: "paused",
      consent: { shareWithAgency: false, snapshotsEnabled: false, snapshotRetentionDays: 7, digestHour: 19, exceptionAlerts: true },
    })
    expect(result.state).toBe("unobservable")
    expect(result.reasons).toEqual([
      "device_offline",
      "motion_recording_off",
      "no_motion_zone",
      "encrypted_device",
      "integration_removed",
      "integration_paused",
      "consent_withdrawn",
    ])
    expect(assessObservability({ devices: [frontDoor({ role: "other" })] }).reasons).toEqual(["no_front_door_device"])
    expect(assessObservability({ ringLinkStatus: "removed" }).reasons).toEqual(["consent_withdrawn"])
  })
})

describe("lifecycle history", () => {
  const from = S - 30 * MIN
  const to = Date.parse(END)

  it("tracks outages and removals that overlap the window", () => {
    expect(lifecycleDuring([], from, to)).toEqual({ offline: false, removed: false })
    const healed = [event(at(START, -120), "device_offline"), event(at(START, -60), "device_online")]
    expect(lifecycleDuring(healed, from, to).offline).toBe(false)
    const removed = [event(at(START, -120), "integration_removed")]
    expect(lifecycleDuring(removed, from, to).removed).toBe(true)
    const readded = [...removed, event(at(START, -100), "integration_added")]
    expect(lifecycleDuring(readded, from, to).removed).toBe(false)
    const proven = [event(at(START, -120), "device_offline"), ding(at(START, -40))]
    expect(lifecycleDuring(proven, from, to).offline).toBe(false)
    const later = [event(at(END, 30), "device_offline")]
    expect(lifecycleDuring(later, from, to).offline).toBe(false)
  })

  it("applies current state only while the window is open and keeps the overlay sticky", () => {
    const v = visit()
    const early = assessVisitObservability(v, { events: [], now: new Date(S - 31 * MIN), ringLinkStatus: "paused" })
    expect(early).toBe(v.observability)
    const open = assessVisitObservability(v, { events: [], now: new Date(S), ringLinkStatus: "paused" })
    expect(open.reasons).toEqual(["integration_paused"])
    const closed = assessVisitObservability(v, { events: [], now: new Date(Date.parse(END) + MIN), ringLinkStatus: "paused" })
    expect(closed.state).toBe("observable")
    const sticky = mergeObservability({ state: "unobservable", reasons: ["device_offline"] }, { state: "observable", reasons: [] })
    expect(sticky).toEqual({ state: "unobservable", reasons: ["device_offline"] })
    expect(mergeObservability({ state: "observable", reasons: [] }, { state: "degraded", reasons: [] }).state).toBe("degraded")
  })
})
