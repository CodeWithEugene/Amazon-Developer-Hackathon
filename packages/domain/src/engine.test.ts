import { describe, expect, it } from "vitest"

import {
  assessObservability,
  arrivalCandidates,
  buildException,
  chooseArrival,
  classifyVisit,
  clusterCandidates,
  detectDeparture,
  findVisitWindow,
  processEvent,
  raiseExceptions,
  reconcile,
  sweepVisits,
  systemResolution,
  type ArrivalCandidate,
  type ArrivalJudge,
} from "./engine"
import {
  DEFAULT_TOLERANCES,
  doorEventSchema,
  type DoorEvent,
  type Exception,
  type Visit,
} from "./types"

const START = "2026-10-01T06:00:00.000Z"
const END = "2026-10-01T08:00:00.000Z"
const T = DEFAULT_TOLERANCES
const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
}

let seq = 0
function event(at: string, type: DoorEvent["type"], subType?: string): DoorEvent {
  seq += 1
  return doorEventSchema.parse({
    ...audit,
    clientId: "c1",
    requestId: `req-${seq}`,
    timestampMs: Date.parse(at),
    at,
    type,
    subType,
    provenance: "emulated",
    rawPayloadHash: `hash-${seq}`,
  })
}

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    ...audit,
    id: "v1",
    clientId: "c1",
    agencyId: "a1",
    caregiverId: "cg1",
    serviceCode: "T1019",
    date: "2026-10-01",
    scheduledStart: START,
    scheduledEnd: END,
    status: "awaiting_arrival",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

describe("findVisitWindow", () => {
  it("matches events within [start - 60 min, end + 60 min]", () => {
    const v = visit()
    expect(findVisitWindow({ id: "c1" }, event("2026-10-01T05:05:00.000Z", "ding"), [v])).toBe(v)
    expect(findVisitWindow({ id: "c1" }, event("2026-10-01T08:55:00.000Z", "ding"), [v])).toBe(v)
    expect(findVisitWindow({ id: "c1" }, event("2026-10-01T04:55:00.000Z", "ding"), [v])).toBeNull()
  })
})

describe("arrivalCandidates and clusters", () => {
  it("keeps ding and human motion inside the window only", () => {
    const v = visit()
    const candidates = arrivalCandidates(v, [
      event("2026-10-01T05:45:00.000Z", "ding"),
      event("2026-10-01T05:50:00.000Z", "motion", "human"),
      event("2026-10-01T05:52:00.000Z", "motion", "vehicle"),
      event("2026-09-01T05:45:00.000Z", "ding"),
    ])
    expect(candidates.map((c) => c.kind)).toEqual(["ding", "human_motion"])
  })

  it("splits clusters more than 20 minutes apart", () => {
    const candidates: ArrivalCandidate[] = [
      { at: "2026-10-01T05:30:00.000Z", eventId: "a", kind: "ding" },
      { at: "2026-10-01T05:35:00.000Z", eventId: "b", kind: "ding" },
      { at: "2026-10-01T06:10:00.000Z", eventId: "c", kind: "ding" },
    ]
    expect(clusterCandidates(candidates)).toHaveLength(2)
  })
})

describe("chooseArrival", () => {
  it("picks the single cluster deterministically", () => {
    const result = chooseArrival(visit(), [
      { at: "2026-10-01T05:50:00.000Z", eventId: "a", kind: "ding" },
    ])
    expect(result).toMatchObject({ outcome: "chosen", method: "rule" })
  })

  it("marks ambiguous when the judge confidence is below 0.7", () => {
    const lowConfidenceJudge: ArrivalJudge = {
      chooseArrival: () => ({ at: "2026-10-01T05:30:00.000Z", confidence: 0.4 }),
    }
    const result = chooseArrival(
      visit(),
      [
        { at: "2026-10-01T05:30:00.000Z", eventId: "a", kind: "ding" },
        { at: "2026-10-01T06:10:00.000Z", eventId: "b", kind: "ding" },
      ],
      { judge: lowConfidenceJudge }
    )
    expect(result).toEqual({ outcome: "ambiguous" })
  })

  it("uses the judge when confident", () => {
    const judge: ArrivalJudge = {
      chooseArrival: () => ({ at: "2026-10-01T05:30:00.000Z", confidence: 0.9 }),
    }
    const result = chooseArrival(
      visit(),
      [
        { at: "2026-10-01T05:30:00.000Z", eventId: "a", kind: "ding" },
        { at: "2026-10-01T06:10:00.000Z", eventId: "b", kind: "ding" },
      ],
      { judge }
    )
    expect(result).toMatchObject({ outcome: "chosen", method: "jev" })
  })
})

describe("detectDeparture", () => {
  it("returns not_observed before the quiet period elapses", () => {
    const v = visit({
      arrival: { at: "2026-10-01T06:00:00.000Z", source: "rule" },
    })
    expect(
      detectDeparture(v, [event("2026-10-01T07:50:00.000Z", "motion", "human")], T.departureQuietMin, new Date("2026-10-01T07:55:00.000Z"))
    ).toBe("not_observed")
  })

  it("records departure at the last human event after the quiet period", () => {
    const v = visit({
      arrival: { at: "2026-10-01T06:00:00.000Z", source: "rule" },
    })
    const departure = detectDeparture(
      v,
      [event("2026-10-01T07:50:00.000Z", "motion", "human")],
      T.departureQuietMin,
      new Date("2026-10-01T08:05:00.000Z")
    )
    expect(departure).toMatchObject({ at: "2026-10-01T07:50:00.000Z" })
  })
})

describe("classifyVisit", () => {
  it("walks the status machine", () => {
    const v = visit({ status: "scheduled" })
    expect(classifyVisit(v, new Date("2026-10-01T05:00:00.000Z"), T)).toBe("scheduled")
    expect(classifyVisit(v, new Date("2026-10-01T05:45:00.000Z"), T)).toBe("awaiting_arrival")
    expect(classifyVisit(v, new Date("2026-10-01T06:40:00.000Z"), T)).toBe("awaiting_arrival")
    expect(classifyVisit(v, new Date("2026-10-01T07:00:00.000Z"), T)).toBe("no_show")

    const arrived = visit({
      arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
    })
    expect(classifyVisit(arrived, new Date("2026-10-01T07:00:00.000Z"), T)).toBe("in_progress")
    expect(classifyVisit(arrived, new Date("2026-10-01T09:10:00.000Z"), T)).toBe("departure_not_observed")

    const completed = visit({
      arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
      departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
    })
    expect(classifyVisit(completed, new Date("2026-10-01T09:00:00.000Z"), T)).toBe("completed")

    const early = visit({
      arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
      departure: { at: "2026-10-01T07:45:00.000Z", source: "rule" },
    })
    expect(classifyVisit(early, new Date("2026-10-01T09:00:00.000Z"), T)).toBe("early_departure")
  })
})

describe("assessObservability", () => {
  const device = (overrides: Partial<Parameters<typeof assessObservability>[0]["devices"][number]> = {}) => ({
    ...audit,
    clientId: "c1",
    ringDeviceId: "d1",
    name: "Front Door",
    online: true,
    capabilities: { motionDetection: true, humanDetection: true, liveView: true, snapshots: true, battery: false },
    motionRecordingEnabled: true,
    hasMotionZone: true,
    role: "front_door" as const,
    ...overrides,
  })

  it("is observable when the front door is healthy", () => {
    expect(assessObservability({ devices: [device()] })).toEqual({ state: "observable", reasons: [] })
  })

  it("flags offline, recording off, no zone, encrypted, and removed integration", () => {
    expect(assessObservability({ devices: [device({ online: false })] }).reasons).toContain("device_offline")
    expect(assessObservability({ devices: [device({ motionRecordingEnabled: false })] }).reasons).toContain("motion_recording_off")
    expect(assessObservability({ devices: [device({ hasMotionZone: false })] }).reasons).toContain("no_motion_zone")
    expect(assessObservability({ devices: [device()], encryptionState: "e2ee" }).reasons).toContain("encrypted_device")
    // TAKE-encrypted devices degrade to unobservable too (solution.md Section 4)
    expect(assessObservability({ devices: [device()], encryptionState: "take" }).reasons).toContain("encrypted_device")
    expect(assessObservability({ devices: [device()], encryptionState: "take" }).state).toBe("unobservable")
    expect(assessObservability({ devices: [device()], integrationStatus: "removed" }).reasons).toContain("integration_removed")
    expect(assessObservability({ devices: [], ringLinkStatus: "paused" }).reasons).toContain("integration_paused")
    expect(assessObservability({ devices: [], ringLinkStatus: "removed" }).reasons).toContain("consent_withdrawn")
  })
})

describe("reconcile", () => {
  const evv = (clockIn: string, clockOut?: string) => ({
    ...audit,
    id: "e1",
    clientId: "c1",
    agencyId: "a1",
    caregiverEvvId: "cg-1",
    serviceCode: "T1019",
    clockIn,
    clockOut,
    source: "csv" as const,
  })

  it("corroborates when deltas are within grace", () => {
    const v = visit({
      arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
      departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
    })
    const result = reconcile({
      visit: v,
      evvRecords: [evv("2026-10-01T06:05:00.000Z", "2026-10-01T08:10:00.000Z")],
      tolerances: T,
    })
    expect(result.outcome).toBe("corroborated")
    expect(result.deltaArrivalMin).toBe(3)
  })

  it("contradicts when arrival is outside grace", () => {
    const v = visit({ arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })
    const result = reconcile({ visit: v, evvRecords: [evv("2026-10-01T07:30:00.000Z")], tolerances: T })
    expect(result.outcome).toBe("contradicted")
  })

  // docs/solution.md Section 6.2 rule 5: corroborated within 10 minutes,
  // contradicted beyond 30, variance band in between.
  it.each([
    [9, "corroborated"],
    [10, "corroborated"],
    [11, "corroborated_with_variance"],
    [29, "corroborated_with_variance"],
    [30, "corroborated_with_variance"],
    [31, "contradicted"],
  ] as const)("classifies an arrival delta of %i minutes as %s", (deltaMin, outcome) => {
    const v = visit({ arrival: { at: "2026-10-01T06:00:00.000Z", source: "rule" } })
    const clockIn = new Date(Date.parse("2026-10-01T06:00:00.000Z") + deltaMin * 60_000).toISOString()
    const result = reconcile({ visit: v, evvRecords: [evv(clockIn)], tolerances: T })
    expect(result.outcome).toBe(outcome)
    expect(result.deltaArrivalMin).toBe(deltaMin)
  })

  it.each([
    [10, "corroborated"],
    [15, "corroborated_with_variance"],
    [31, "contradicted"],
  ] as const)("classifies a departure delta of %i minutes as %s", (deltaMin, outcome) => {
    const v = visit({
      arrival: { at: "2026-10-01T06:00:00.000Z", source: "rule" },
      departure: { at: "2026-10-01T08:00:00.000Z", source: "rule" },
    })
    const clockOut = new Date(Date.parse("2026-10-01T08:00:00.000Z") + deltaMin * 60_000).toISOString()
    const result = reconcile({
      visit: v,
      evvRecords: [evv("2026-10-01T06:02:00.000Z", clockOut)],
      tolerances: T,
    })
    expect(result.outcome).toBe(outcome)
  })

  it("contradicts when the door saw no arrival but a clock-in exists", () => {
    const result = reconcile({ visit: visit(), evvRecords: [evv("2026-10-01T06:10:00.000Z")], tolerances: T })
    expect(result.outcome).toBe("contradicted")
  })

  it("reports missing clock-in and missing both", () => {
    const arrived = visit({ arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })
    expect(reconcile({ visit: arrived, evvRecords: [], tolerances: T }).outcome).toBe("missing_clock_in")
    expect(reconcile({ visit: visit(), evvRecords: [], tolerances: T }).outcome).toBe("missing_both")
  })

  it("reports unobservable when the visit is unobservable", () => {
    const v = visit({ observability: { state: "unobservable", reasons: ["device_offline"] } })
    expect(reconcile({ visit: v, evvRecords: [evv("2026-10-01T06:10:00.000Z")], tolerances: T }).outcome).toBe("unobservable")
  })
})

describe("raiseExceptions", () => {
  it("raises new ids and resolves stale system-owned ones", () => {
    const existing: Exception = { ...buildException("late_no_arrival", visit(), new Date("2026-10-01T06:20:00.000Z")), state: "open" }
    const desired = buildException("no_show", visit(), new Date("2026-10-01T06:50:00.000Z"))
    const delta = raiseExceptions([existing], [desired])
    expect(delta.toRaise).toEqual([desired])
    expect(delta.toResolveIds).toEqual([existing.id])
  })

  it("never auto-resolves human-review cards, even when they are not re-desired", () => {
    const now = new Date("2026-10-01T06:30:00.000Z")
    const humanKinds = ["late_arrival", "early_departure", "ambiguous", "unobservable", "no_show"] as const
    const humanCards: Exception[] = humanKinds.map((kind) => ({
      ...buildException(kind, visit(), now),
      state: "open",
    }))
    const delta = raiseExceptions(humanCards, [])
    expect(delta.toRaise).toEqual([])
    expect(delta.toResolveIds).toEqual([])
  })
})

describe("processEvent", () => {
  it("records an on-time arrival", () => {
    const ding = event("2026-10-01T05:58:00.000Z", "ding")
    const result = processEvent({
      event: ding,
      events: [ding],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T05:58:05.000Z"),
    })
    expect(result.matched).toBe(true)
    expect(result.visit?.status).toBe("arrived_on_time")
    expect(result.visit?.arrival?.eventId).toBe(ding.requestId)
  })

  it("records a late arrival and resolves the late_no_arrival exception", () => {
    const late = event("2026-10-01T06:30:00.000Z", "motion", "human")
    const open = buildException("late_no_arrival", visit(), new Date("2026-10-01T06:16:00.000Z"))
    const result = processEvent({
      event: late,
      events: [late],
      visits: [visit()],
      openExceptions: [open],
      tolerances: T,
      now: new Date("2026-10-01T06:30:05.000Z"),
    })
    expect(result.visit?.status).toBe("arrived_late")
    expect(result.toRaise.map((e) => e.kind)).toContain("late_arrival")
    expect(result.toResolveIds).toContain(open.id)
  })

  it("marks ambiguous visits for human review", () => {
    const judge: ArrivalJudge = { chooseArrival: () => ({ at: "2026-10-01T05:35:00.000Z", confidence: 0.3 }) }
    const first = event("2026-10-01T05:35:00.000Z", "ding")
    const second = event("2026-10-01T06:05:00.000Z", "motion", "human")
    const result = processEvent({
      event: second,
      events: [first, second],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T06:05:05.000Z"),
      judge,
    })
    expect(result.visit?.status).toBe("ambiguous")
    expect(result.toRaise.map((e) => e.kind)).toContain("ambiguous")
  })

  it("records departure after the quiet period and flags early departure", () => {
    const arrival = event("2026-10-01T06:00:00.000Z", "ding")
    const lastHuman = event("2026-10-01T07:40:00.000Z", "motion", "human")
    const arrived = visit({
      arrival: { at: arrival.at, eventId: arrival.requestId, source: "rule" },
      status: "in_progress",
    })
    const result = processEvent({
      event: lastHuman,
      events: [arrival, lastHuman],
      visits: [arrived],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T07:55:00.000Z"),
    })
    expect(result.visit?.status).toBe("early_departure")
    expect(result.visit?.departure?.at).toBe(lastHuman.at)
    expect(result.toRaise.map((e) => e.kind)).toContain("early_departure")
  })

  it("completes a full visit", () => {
    const arrival = event("2026-10-01T06:00:00.000Z", "ding")
    const lastHuman = event("2026-10-01T08:10:00.000Z", "motion", "human")
    const arrived = visit({
      arrival: { at: arrival.at, eventId: arrival.requestId, source: "rule" },
      status: "in_progress",
    })
    const result = processEvent({
      event: lastHuman,
      events: [arrival, lastHuman],
      visits: [arrived],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T08:30:00.000Z"),
    })
    expect(result.visit?.status).toBe("completed")
  })

  it("ignores unmatched events", () => {
    const result = processEvent({
      event: event("2026-10-01T23:00:00.000Z", "ding"),
      events: [],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T23:00:05.000Z"),
    })
    expect(result.matched).toBe(false)
    expect(result.visit).toBeUndefined()
  })

  it("does not change unobservable visits", () => {
    const ding = event("2026-10-01T05:58:00.000Z", "ding")
    const result = processEvent({
      event: ding,
      events: [ding],
      visits: [visit({ observability: { state: "unobservable", reasons: ["device_offline"] } })],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T05:58:05.000Z"),
    })
    expect(result.visit?.status).toBe("awaiting_arrival")
    expect(result.toRaise).toEqual([])
  })
})

describe("sweepVisits", () => {
  it("opens the arrival window", () => {
    const result = sweepVisits({
      visits: [visit({ status: "scheduled" })],
      events: [],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T05:40:00.000Z"),
    })
    expect(result.visits[0]?.status).toBe("awaiting_arrival")
  })

  it("raises late_no_arrival after grace and no_show after escalation", () => {
    const late = sweepVisits({
      visits: [visit()],
      events: [],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T06:20:00.000Z"),
    })
    expect(late.toRaise.map((e) => e.kind)).toEqual(["late_no_arrival"])
    expect(late.visits[0]?.status).toBe("awaiting_arrival")

    const open = late.toRaise as Exception[]
    const noShow = sweepVisits({
      visits: late.visits,
      events: [],
      openExceptions: open,
      tolerances: T,
      now: new Date("2026-10-01T06:50:00.000Z"),
    })
    expect(noShow.visits[0]?.status).toBe("no_show")
    expect(noShow.toRaise.map((e) => e.kind)).toEqual(["no_show"])
    expect(noShow.toResolveIds).toEqual(open.map((e) => e.id))

    // Sweep re-entry: the no_show card is a human-review card, so a third
    // sweep neither re-raises nor auto-resolves it.
    const noShowCards = noShow.toRaise as Exception[]
    const reSweep = sweepVisits({
      visits: noShow.visits,
      events: [],
      openExceptions: noShowCards,
      tolerances: T,
      now: new Date("2026-10-01T07:30:00.000Z"),
    })
    expect(reSweep.toRaise).toEqual([])
    expect(reSweep.toResolveIds).toEqual([])
  })

  it("keeps a human-review late_arrival card open across re-sweeps and does not churn the status", () => {
    const lateArrival = {
      at: "2026-10-01T06:20:00.000Z",
      eventId: "req-late",
      source: "rule" as const,
    }
    const lateVisit = visit({ arrival: lateArrival, status: "arrived_late" })
    const card: Exception = {
      ...buildException("late_arrival", lateVisit, new Date("2026-10-01T06:21:00.000Z")),
      state: "open",
    }
    // Re-sweep well past the quiet period: the old engine reclassified the
    // visit to in_progress and auto-closed the card in the same tick.
    const swept = sweepVisits({
      visits: [lateVisit],
      events: [],
      openExceptions: [card],
      tolerances: T,
      now: new Date("2026-10-01T07:00:00.000Z"),
    })
    expect(swept.visits[0]?.status).toBe("arrived_late")
    expect(swept.toRaise).toEqual([])
    expect(swept.toResolveIds).toEqual([])
  })

  it("still auto-resolves late_no_arrival once an arrival is observed by the sweep", () => {
    const arrivalEvent = event("2026-10-01T06:10:00.000Z", "ding")
    const arrivedVisit = visit({
      arrival: { at: arrivalEvent.at, eventId: arrivalEvent.requestId, source: "rule" },
      status: "arrived_on_time",
    })
    const card: Exception = {
      ...buildException("late_no_arrival", arrivedVisit, new Date("2026-10-01T06:16:00.000Z")),
      state: "open",
    }
    const swept = sweepVisits({
      visits: [arrivedVisit],
      events: [arrivalEvent],
      openExceptions: [card],
      tolerances: T,
      now: new Date("2026-10-01T06:30:00.000Z"),
    })
    expect(swept.toResolveIds).toEqual([card.id])
  })

  it("never raises no_show for unobservable visits", () => {
    const result = sweepVisits({
      visits: [visit({ observability: { state: "unobservable", reasons: ["device_offline"] } })],
      events: [],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T07:00:00.000Z"),
    })
    expect(result.visits[0]?.status).toBe("unobservable")
    expect(result.toRaise.map((e) => e.kind)).toEqual(["unobservable"])
  })

  it("records departure via the quiet period", () => {
    const arrival = event("2026-10-01T06:00:00.000Z", "ding")
    const lastHuman = event("2026-10-01T08:05:00.000Z", "motion", "human")
    const result = sweepVisits({
      visits: [
        visit({
          arrival: { at: arrival.at, eventId: arrival.requestId, source: "rule" },
          status: "in_progress",
        }),
      ],
      events: [arrival, lastHuman],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T08:20:00.000Z"),
    })
    expect(result.visits[0]?.status).toBe("completed")
    expect(result.visits[0]?.departure?.at).toBe(lastHuman.at)
  })

  it("sets departure_not_observed when events continue past end + 60 min", () => {
    const arrival = event("2026-10-01T06:00:00.000Z", "ding")
    const late = event("2026-10-01T09:10:00.000Z", "motion", "human")
    const result = sweepVisits({
      visits: [
        visit({
          arrival: { at: arrival.at, eventId: arrival.requestId, source: "rule" },
          status: "in_progress",
        }),
      ],
      events: [arrival, late],
      openExceptions: [],
      tolerances: T,
      now: new Date("2026-10-01T09:20:00.000Z"),
    })
    expect(result.visits[0]?.status).toBe("departure_not_observed")
  })

  it("is deterministic: identical inputs give identical outputs", () => {
    const input = {
      visits: [visit()],
      events: [event("2026-10-01T06:10:00.000Z", "ding")],
      openExceptions: [] as Exception[],
      tolerances: T,
      now: new Date("2026-10-01T06:30:00.000Z"),
    }
    expect(sweepVisits(input)).toEqual(sweepVisits(input))
  })
})

describe("systemResolution", () => {
  it("builds a system resolution", () => {
    expect(systemResolution(new Date("2026-10-01T06:30:00.000Z"), "arrival observed")).toEqual({
      by: "system",
      at: "2026-10-01T06:30:00.000Z",
      reason: "arrival observed",
    })
  })
})
