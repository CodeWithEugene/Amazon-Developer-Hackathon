/**
 * Spec-driven scenario replay (docs/build.md Section 11, docs/solution.md
 * Section 6.2): every emulator scenario is replayed through processEvent
 * plus a one-minute sweep with an injected clock, and the outcome is
 * checked against the EARS requirements, not against what the code does.
 */
import { SCENARIOS, type PrimitiveKind, type ScenarioName } from "@visitproof/ring-partner-sdk"
import { describe, expect, it } from "vitest"

import type { DeviceStates } from "../src/engine"
import type { DoorEvent, VisitStatus } from "../src/types"
import { event, kindsOf, MIN, replay, START, visit } from "./helpers"

const START_MS = Date.parse(START)

function toDoorEvent(kind: PrimitiveKind, atMs: number): DoorEvent | null {
  const when = new Date(atMs).toISOString()
  switch (kind) {
    case "ding":
      return event(when, "ding")
    case "motion_human":
      return event(when, "motion", "human")
    case "motion_vehicle":
      return event(when, "motion", "vehicle")
    case "device_offline":
      return event(when, "device_offline")
    case "device_online":
      return event(when, "device_online")
    case "integration_removed":
      return event(when, "integration_removed")
    case "integration_added":
      return event(when, "integration_added")
    default:
      return null
  }
}

interface Expected {
  status: VisitStatus
  arrivalOffsetMs?: number
  departureOffsetMs?: number
  open: string[]
  resolved?: string[]
  reasons?: string[]
  deviceStates?: DeviceStates
}

/** Spec outcome per scenario (EARS rule numbers in comments). */
const EXPECTED: Record<ScenarioName, Expected> = {
  // R2: a ding at the start is the arrival; nothing follows it, so no departure (R6/R7)
  ding: { status: "departure_not_observed", arrivalOffsetMs: 0, open: [] },
  motion: { status: "departure_not_observed", arrivalOffsetMs: 0, open: [] },
  // R6: the only human event after arrival is 30 s in, so the final departure is early
  arrival: { status: "early_departure", arrivalOffsetMs: 0, departureOffsetMs: 30_000, open: ["early_departure"] },
  // R2/R4: human motion at the scheduled end is outside the arrival range, so no arrival
  departure: { status: "no_show", open: ["no_show"], resolved: ["late_no_arrival"] },
  // R6: the entry motion at +30 s is superseded by the exit at end + 5 s
  on_time: { status: "completed", arrivalOffsetMs: 0, departureOffsetMs: 2 * 60 * MIN + 5_000, open: [] },
  // R4/R5: late_no_arrival at grace, auto-resolved by the late arrival; late_arrival stays for review
  late_arrival: {
    status: "completed",
    arrivalOffsetMs: 20 * MIN,
    departureOffsetMs: 20 * MIN + 2 * 60 * MIN,
    open: ["late_arrival"],
    resolved: ["late_no_arrival"],
  },
  // R4
  no_show: { status: "no_show", open: ["no_show"], resolved: ["late_no_arrival"] },
  // R6: departure 30 minutes into a 2 hour visit
  early_departure: {
    status: "early_departure",
    arrivalOffsetMs: 0,
    departureOffsetMs: 30 * MIN,
    open: ["early_departure"],
  },
  // R2/R3: vehicle motion is not an arrival signal, so the ding and human motion
  // form one 5 minute cluster: a rule arrival, not a Judge call. The human
  // motion at +45 s is the last human event, so the final departure is early.
  double_visitor: {
    status: "early_departure",
    arrivalOffsetMs: 0,
    departureOffsetMs: 45_000,
    open: ["early_departure"],
  },
  // R8: offline for part of the window overlays unobservable and never raises
  // no_show; the arrival seen before the outage stays, no departure is derived
  device_offline_mid_visit: {
    status: "unobservable",
    arrivalOffsetMs: 0,
    open: ["unobservable"],
    reasons: ["device_offline"],
  },
  // R8: an encrypted device is unobservable from the start of the window even
  // though events flow, so the overlay records no boundaries from them
  encrypted_device: {
    status: "unobservable",
    open: ["unobservable"],
    reasons: ["encrypted_device"],
    deviceStates: { encryptionState: "take" },
  },
  // R8: the integration removed during the window
  integration_removed: {
    status: "unobservable",
    open: ["unobservable"],
    reasons: ["integration_removed"],
  },
}

function runScenario(name: ScenarioName) {
  const script = SCENARIOS[name]
  const v = visit({ scheduledEnd: new Date(START_MS + script.visitDurationMs).toISOString() })
  const events = script.steps
    .map((step) => toDoorEvent(step.kind, START_MS + step.offsetMs))
    .filter((e): e is DoorEvent => e !== null)
  return replay({
    visits: [v],
    events,
    from: START_MS - 90 * MIN,
    to: START_MS + script.visitDurationMs + 120 * MIN,
    deviceStates: EXPECTED[name].deviceStates,
  })
}

describe("emulator scenarios through processEvent plus a one-minute sweep", () => {
  const names = Object.keys(SCENARIOS) as ScenarioName[]

  it("has a spec expectation for every scenario", () => {
    expect(names.sort()).toEqual((Object.keys(EXPECTED) as ScenarioName[]).sort())
  })

  it.each(names)("%s matches the spec outcome", (name) => {
    const expected = EXPECTED[name]
    const state = runScenario(name)
    const final = state.visits[0]!
    expect(final.status).toBe(expected.status)
    const offset = (iso?: string) => (iso === undefined ? undefined : Date.parse(iso) - START_MS)
    expect(offset(final.arrival?.at)).toBe(expected.arrivalOffsetMs)
    expect(offset(final.departure?.at)).toBe(expected.departureOffsetMs)
    expect(kindsOf(state.exceptions, "open")).toEqual(expected.open)
    expect(kindsOf(state.exceptions, "resolved")).toEqual(expected.resolved ?? [])
    expect(final.observability.reasons).toEqual(expected.reasons ?? [])
    // Each card is requested exactly once across the whole replay
    expect(new Set(state.raisedIds).size).toBe(state.raisedIds.length)
    if (final.status === "unobservable") expect(state.raisedIds.some((id) => id.endsWith("#no_show"))).toBe(false)
  })

  it.each(names)("%s replays deterministically from fresh inputs", (name) => {
    const strip = (s: ReturnType<typeof runScenario>) =>
      JSON.stringify({
        visits: s.visits.map(({ status, arrival, departure, observability }) => ({
          status,
          arrival: arrival?.at,
          departure: departure?.at,
          observability,
        })),
        cards: s.exceptions.map((e) => [e.id, e.state, e.openedAt]),
      })
    expect(strip(runScenario(name))).toBe(strip(runScenario(name)))
  })
})
