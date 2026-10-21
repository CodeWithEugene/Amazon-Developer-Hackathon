import { describe, expect, it } from "vitest"

import {
  buildException,
  planExceptions,
  raiseExceptions,
  reconcile,
  systemResolution,
} from "../src/engine"
import type { EVVRecord, Exception } from "../src/types"
import { at, audit, ding, END, START, T, visit } from "./helpers"

function evv(clockIn: string, clockOut?: string, overrides: Partial<EVVRecord> = {}): EVVRecord {
  return {
    ...audit,
    id: "evv1",
    clientId: "c1",
    agencyId: "a1",
    caregiverEvvId: "E1",
    serviceCode: "T1019",
    clockIn,
    clockOut,
    source: "csv",
    ...overrides,
  }
}

describe("reconcile", () => {
  const door = visit({
    arrival: { at: at(START, 2), source: "rule", eventId: "req-door" },
    departure: { at: at(END, 3), source: "rule" },
  })

  it("applies the 10 and 30 minute bands to both deltas", () => {
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 5), at(END, 0))], tolerances: T })).toMatchObject({
      outcome: "corroborated",
      deltaArrivalMin: 3,
      deltaDepartureMin: -3,
    })
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 20))], tolerances: T }).outcome).toBe(
      "corroborated_with_variance"
    )
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 2), at(END, 40))], tolerances: T }).outcome).toBe(
      "contradicted"
    )
  })

  it("matches EVV by visit id first, then by client and window", () => {
    const other = evv(at(START, 90), undefined, { id: "evv2", visitId: "v1" })
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 2)), other], tolerances: T }).evvRecordId).toBe("evv2")
    const elsewhere = evv(at(START, 2), undefined, { clientId: "c2" })
    expect(reconcile({ visit: door, evvRecords: [elsewhere], tolerances: T }).outcome).toBe("missing_clock_in")
  })

  it("contradicts a clock-in with no door presence and reports missing both", () => {
    expect(reconcile({ visit: visit(), evvRecords: [evv(at(START, 5))], tolerances: T }).outcome).toBe("contradicted")
    expect(reconcile({ visit: visit(), evvRecords: [], tolerances: T }).outcome).toBe("missing_both")
  })

  it("never lets a manual (agency-entered) arrival corroborate a clock-in (contract C2)", () => {
    const manual = visit({ arrival: { at: START, source: "manual" } })
    expect(reconcile({ visit: manual, evvRecords: [evv(START)], tolerances: T })).toMatchObject({
      outcome: "missing_door",
      evvRecordId: "evv1",
    })
    expect(reconcile({ visit: manual, evvRecords: [], tolerances: T }).outcome).toBe("missing_both")
  })

  it("requires the source door event when events are supplied", () => {
    const event = ding(at(START, 2), { requestId: "req-door" })
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 2))], tolerances: T, events: [event] }).outcome).toBe(
      "corroborated"
    )
    // A boundary with no door event behind it is not door evidence
    expect(reconcile({ visit: door, evvRecords: [evv(at(START, 2))], tolerances: T, events: [] }).outcome).toBe(
      "missing_door"
    )
  })

  it("reports unobservable visits as unobservable", () => {
    const blind = visit({ observability: { state: "unobservable", reasons: ["device_offline"] } })
    expect(reconcile({ visit: blind, evvRecords: [evv(START)], tolerances: T }).outcome).toBe("unobservable")
  })
})

describe("exceptions", () => {
  const now = new Date(at(START, 20))

  it("raises new ids, dedupes against any state, and resolves stale system-owned cards", () => {
    const open = buildException("late_no_arrival", visit(), now)
    const resolved: Exception = { ...buildException("no_show", visit(), now), state: "resolved" }
    const delta = raiseExceptions([open, resolved], [buildException("no_show", visit(), now)])
    expect(delta.toRaise).toEqual([])
    expect(delta.toResolveIds).toEqual([open.id])
  })

  it("never auto-resolves human-review cards through raiseExceptions", () => {
    const cards = (["late_arrival", "early_departure", "ambiguous", "unobservable"] as const).map((kind) =>
      buildException(kind, visit(), now)
    )
    expect(raiseExceptions(cards, []).toResolveIds).toEqual([])
  })

  it("remembers raised kinds on the visit and returns it unchanged when nothing is new", () => {
    const plan = planExceptions(visit(), ["late_no_arrival"], [], now)
    expect(plan.toRaise.map((e) => e.id)).toEqual(["v1#late_no_arrival"])
    expect(plan.visit.raisedExceptionKinds).toEqual(["late_no_arrival"])
    const again = planExceptions(plan.visit, ["late_no_arrival"], [], now)
    expect(again.toRaise).toEqual([])
    expect(again.visit).toBe(plan.visit)
  })

  it("explains each system resolution of late_no_arrival", () => {
    const card = buildException("late_no_arrival", visit(), now)
    const reason = (overrides: Parameters<typeof visit>[0]) =>
      planExceptions(visit(overrides), [], [card], now).resolutions[0]?.reason
    expect(reason({ status: "unobservable" })).toBe("Door unobservable")
    expect(reason({ status: "ambiguous" })).toBe("Arrival needs review")
    expect(reason({ status: "no_show" })).toBe("Escalated to no-show")
    expect(reason({ arrival: { at: START, source: "rule" }, status: "arrived_late" })).toBe("Arrival observed")
    expect(reason({ status: "awaiting_arrival" })).toBe("Superseded")
  })

  it("does not resolve a no_show card for a manual arrival", () => {
    const card = buildException("no_show", visit(), now)
    const plan = planExceptions(visit({ arrival: { at: START, source: "manual" } }), [], [card], now)
    expect(plan.resolutions).toEqual([])
  })

  it("builds system resolutions with an optional note", () => {
    expect(systemResolution(now, "superseded")).toEqual({ by: "system", at: now.toISOString(), reason: "superseded" })
    expect(systemResolution(now, "r", "n").note).toBe("n")
  })
})
