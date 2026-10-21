import { describe, expect, it } from "vitest"

import { processEvent, sweepVisits, type ArrivalJudge } from "../src/engine"
import type { Exception } from "../src/types"
import { at, ding, END, event, human, kindsOf, MIN, replay, START, T, visit } from "./helpers"

const S = Date.parse(START)
const E = Date.parse(END)

describe("processEvent", () => {
  it("ignores events outside every visit window", () => {
    const result = processEvent({
      event: ding(at(START, -61)),
      events: [],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date(at(START, -61)),
    })
    expect(result).toEqual({ matched: false, toRaise: [], toResolveIds: [], resolutions: [] })
  })

  it("records an on-time rule arrival and appends the event if the caller left it out", () => {
    const d = ding(at(START, 2))
    const result = processEvent({
      event: d,
      events: [],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date(at(START, 2)),
    })
    expect(result.visit?.status).toBe("arrived_on_time")
    expect(result.visit?.arrival).toEqual({ at: d.at, eventId: d.requestId, source: "rule", confidence: 0.9 })
  })

  it("resolves late_no_arrival with an arrival reason when a late arrival lands", () => {
    const open = { ...lateNoArrival(), state: "open" as const }
    const d = ding(at(START, 22))
    const result = processEvent({
      event: d,
      events: [d],
      visits: [visit({ status: "awaiting_arrival" })],
      openExceptions: [open],
      tolerances: T,
      now: new Date(at(START, 22)),
    })
    expect(result.visit?.status).toBe("arrived_late")
    expect(result.toRaise.map((e) => e.kind)).toEqual(["late_arrival"])
    expect(result.resolutions).toEqual([{ id: open.id, reason: "Arrival observed" }])
    expect(result.toResolveIds).toEqual([open.id])
  })
})

function lateNoArrival(): Exception {
  return {
    id: "v1#late_no_arrival",
    agencyId: "a1",
    visitId: "v1",
    clientId: "c1",
    kind: "late_no_arrival",
    state: "open",
    openedAt: at(START, 15),
    createdAt: at(START, 15),
    updatedAt: at(START, 15),
    version: 1,
  }
}

const window = { from: S - 90 * MIN, to: E + 130 * MIN }

describe("arrival clusters and the Judge (EARS 3)", () => {
  it("re-evaluates a delivery before the caregiver instead of locking the first candidate", () => {
    const state = replay({
      visits: [visit()],
      events: [human(at(START, -25)), ding(at(START, 2)), human(at(START, 125))],
      ...window,
    })
    const final = state.visits[0]!
    expect(final.arrival?.at).toBe(at(START, 2))
    expect(final.arrival?.source).toBe("rule")
    expect(final.status).toBe("completed")
    expect(kindsOf(state.exceptions)).toEqual([])
  })

  it("marks close calls ambiguous with the rule judge and never escalates them to no_show", () => {
    const state = replay({
      visits: [visit()],
      events: [human(at(START, -15)), ding(at(START, 10))],
      ...window,
    })
    expect(state.visits[0]!.status).toBe("ambiguous")
    expect(state.visits[0]!.arrival).toBeUndefined()
    expect(kindsOf(state.exceptions)).toEqual(["ambiguous"])
  })

  it("labels an injected judge's decision as jev and logs the judgment", () => {
    const jev: ArrivalJudge = { chooseArrival: ({ candidates }) => ({ at: candidates.at(-1)!.at, confidence: 0.92 }) }
    const early = human(at(START, -25))
    const late = ding(at(START, 2))
    const result = processEvent({
      event: late,
      events: [early, late],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date(at(START, 3)),
      judge: jev,
    })
    expect(result.visit?.arrival).toMatchObject({ at: late.at, source: "jev", confidence: 0.92 })
    expect(result.judgment?.judge).toBe("jev")
    expect(result.judgment?.input.clusters).toHaveLength(2)
  })

  it("raises ambiguous when the injected judge is unsure", () => {
    const unsure: ArrivalJudge = { kind: "jev", chooseArrival: ({ candidates }) => ({ at: candidates[0]!.at, confidence: 0.4 }) }
    const early = human(at(START, -25))
    const late = ding(at(START, 2))
    const result = processEvent({
      event: late,
      events: [early, late],
      visits: [visit()],
      openExceptions: [],
      tolerances: T,
      now: new Date(at(START, 3)),
      judge: unsure,
    })
    expect(result.visit?.status).toBe("ambiguous")
    expect(result.toRaise.map((e) => e.kind)).toEqual(["ambiguous"])
  })
})

describe("departure revision (EARS 6 and 7)", () => {
  it("moves the departure later as in-window events arrive and never flags a step outside", () => {
    const state = replay({
      visits: [visit()],
      events: [ding(START), human(at(START, 0.5)), human(at(START, 60)), human(at(START, 62)), human(at(END, 3))],
      ...window,
    })
    expect(state.visits[0]!.status).toBe("completed")
    expect(state.visits[0]!.departure?.at).toBe(at(END, 3))
    expect(state.raisedIds).toEqual([])
  })

  it("keeps a recorded on-time departure until new activity goes quiet, then revises it", () => {
    const events = [ding(START), human(at(END, 5)), human(at(END, 30))]
    const mid = replay({ visits: [visit()], events, from: window.from, to: E + 35 * MIN })
    expect(mid.visits[0]!.status).toBe("completed")
    expect(mid.visits[0]!.departure?.at).toBe(at(END, 5))
    const done = replay({ visits: [visit()], events, from: window.from, to: E + 45 * MIN })
    expect(done.visits[0]!.departure?.at).toBe(at(END, 30))
  })

  it("sets departure_not_observed when human activity continues past end + 60 min", () => {
    const state = replay({
      visits: [visit()],
      events: [ding(START), human(at(END, 55)), human(at(END, 62))],
      ...window,
    })
    expect(state.visits[0]!.status).toBe("departure_not_observed")
    expect(state.visits[0]!.departure).toBeUndefined()
  })

  it("judges an early departure only when the window closes", () => {
    const events = [ding(START), human(at(START, 30))]
    const before = replay({ visits: [visit()], events, from: window.from, to: E + 59 * MIN })
    expect(before.visits[0]!.status).toBe("in_progress")
    const after = replay({ visits: [visit()], events, from: window.from, to: E + 60 * MIN })
    expect(after.visits[0]!.status).toBe("early_departure")
    expect(kindsOf(after.exceptions)).toEqual(["early_departure"])
  })
})

describe("tolerance boundaries", () => {
  const statusAfter = (events: ReturnType<typeof ding>[], to: number) =>
    replay({ visits: [visit()], events, from: window.from, to }).visits[0]!

  it("accepts an arrival at exactly start - 30 min and ignores one a second earlier", () => {
    expect(statusAfter([ding(at(START, -30))], S).arrival?.at).toBe(at(START, -30))
    expect(statusAfter([ding(new Date(S - 30 * MIN - 1_000).toISOString())], S).arrival).toBeUndefined()
  })

  it("is on time at exactly start + grace and late one second after", () => {
    expect(statusAfter([ding(at(START, 15))], S + 16 * MIN).status).toBe("arrived_on_time")
    expect(statusAfter([ding(new Date(S + 15 * MIN + 1_000).toISOString())], S + 16 * MIN).status).toBe(
      "arrived_late"
    )
  })

  it("escalates to no_show at exactly start + escalation", () => {
    expect(statusAfter([], S + 44 * MIN).status).toBe("awaiting_arrival")
    expect(statusAfter([], S + 45 * MIN).status).toBe("no_show")
  })

  it("completes a departure at exactly end - earlyDepartureMin", () => {
    const events = [ding(START), human(at(END, -10))]
    expect(statusAfter(events, E + 61 * MIN).status).toBe("completed")
    const early = [ding(START), human(new Date(E - 10 * MIN - 1_000).toISOString())]
    expect(statusAfter(early, E + 61 * MIN).status).toBe("early_departure")
  })

  it("stops accepting arrivals after start + 60 min", () => {
    expect(statusAfter([ding(at(START, 60))], S + 61 * MIN).arrival?.at).toBe(at(START, 60))
    expect(statusAfter([ding(at(START, 61))], S + 62 * MIN).status).toBe("no_show")
  })
})

describe("arrival after the no_show escalation (Journey D)", () => {
  it("system-resolves the no_show card with a clear note and marks the visit late", () => {
    const state = replay({
      visits: [visit()],
      events: [ding(at(START, 50)), human(at(END, 5))],
      ...window,
    })
    expect(state.visits[0]!.status).toBe("completed")
    expect(kindsOf(state.exceptions, "open")).toEqual(["late_arrival"])
    expect(kindsOf(state.exceptions, "resolved")).toEqual(["late_no_arrival", "no_show"])
    const noShow = state.resolutions.find((r) => r.id === "v1#no_show")
    expect(noShow?.reason).toBe("Arrived after no-show escalation")
    expect(noShow?.note).toContain(at(START, 50))
  })

  it("renders the note in the agency time zone when one is given", () => {
    const d = ding(at(START, 50))
    const result = processEvent({
      event: d,
      events: [d],
      visits: [visit({ status: "no_show", raisedExceptionKinds: ["late_no_arrival", "no_show"] })],
      openExceptions: [{ ...lateNoArrival(), id: "v1#no_show", kind: "no_show" }],
      tolerances: T,
      now: new Date(at(START, 51)),
      timeZone: "America/New_York",
    })
    expect(result.visit?.status).toBe("arrived_late")
    expect(result.resolutions?.[0]?.note).toContain("9:50 AM ET")
  })
})

describe("idempotent cards", () => {
  it("never re-requests a card a person resolved or snoozed", () => {
    const state = replay({
      visits: [visit()],
      events: [],
      ...window,
      onTick: (_now, exceptions) =>
        exceptions.map((e) =>
          e.kind === "no_show" && e.state === "open"
            ? { ...e, state: "resolved" as const, resolution: { by: "dana", at: e.openedAt, reason: "Called" } }
            : e.kind === "late_no_arrival" && e.state === "open"
              ? { ...e, state: "snoozed" as const }
              : e
        ),
    })
    expect(state.raisedIds).toEqual(["v1#late_no_arrival", "v1#no_show"])
    expect(state.visits[0]!.raisedExceptionKinds).toEqual(["late_no_arrival", "no_show"])
  })

  it("dedupes against exceptions in any state for visits without card memory", () => {
    const resolved: Exception = { ...lateNoArrival(), id: "v1#unobservable", kind: "unobservable", state: "resolved" }
    const unobservable = visit({ status: "unobservable", observability: { state: "unobservable", reasons: ["device_offline"] } })
    const input = { visits: [unobservable], events: [], openExceptions: [], tolerances: T, now: new Date(S) }
    expect(sweepVisits(input).toRaise.map((e) => e.id)).toEqual(["v1#unobservable"])
    expect(sweepVisits({ ...input, exceptions: [resolved] }).toRaise).toEqual([])
  })
})

describe("overlapping visits for one client (EARS 1)", () => {
  const a = visit({ id: "vA", scheduledStart: at(START, 0), scheduledEnd: at(START, 120) })
  const b = visit({ id: "vB", scheduledStart: at(START, 150), scheduledEnd: at(START, 270) })
  const events = [
    ding(at(START, 0)),
    human(new Date(S + 120 * MIN + 5_000).toISOString()),
    ding(at(START, 150)),
    human(new Date(S + 270 * MIN + 5_000).toISOString()),
  ]

  it("assigns each event to the nearest visit so both complete cleanly", () => {
    const state = replay({ visits: [a, b], events, from: S - 90 * MIN, to: S + 420 * MIN })
    expect(state.visits.map((v) => [v.id, v.status, v.arrival?.at])).toEqual([
      ["vA", "completed", at(START, 0)],
      ["vB", "completed", at(START, 150)],
    ])
    expect(state.raisedIds).toEqual([])
  })

  it("uses contextVisits so a settled visit keeps its own exit motion", () => {
    const settledA = { ...a, status: "completed" as const, arrival: { at: at(START, 0), source: "rule" as const } }
    const exitA = events[1]!
    const result = sweepVisits({
      visits: [b],
      contextVisits: [settledA, b],
      events: [exitA],
      openExceptions: [],
      tolerances: T,
      now: new Date(S + 125 * MIN),
    })
    expect(result.visits[0]!.arrival).toBeUndefined()
    // Without the settled visit, A's exit would be read as B's early arrival
    const blind = sweepVisits({ visits: [b], events: [exitA], openExceptions: [], tolerances: T, now: new Date(S + 125 * MIN) })
    expect(blind.visits[0]!.arrival?.at).toBe(exitA.at)
  })
})

describe("observability overlay on the engine path (EARS 8)", () => {
  it("overlays integration_paused from the client's ringLinkStatus", () => {
    const state = replay({
      visits: [visit()],
      events: [],
      ...window,
      client: { id: "c1", ringLinkStatus: "paused" },
    })
    expect(state.visits[0]!.status).toBe("unobservable")
    expect(state.visits[0]!.observability.reasons).toEqual(["integration_paused"])
    expect(kindsOf(state.exceptions)).toEqual(["unobservable"])
  })

  it("carries an outage that began before the window into it", () => {
    const state = replay({
      visits: [visit()],
      events: [event(at(START, -120), "device_offline"), event(at(START, 30), "device_online")],
      ...window,
    })
    expect(state.visits[0]!.observability.reasons).toEqual(["device_offline"])
    expect(state.raisedIds).toEqual(["v1#unobservable"])
  })

  it("ignores lifecycle events for devices that are not the front door", () => {
    const device = {
      createdAt: START,
      updatedAt: START,
      version: 1,
      clientId: "c1",
      ringDeviceId: "front",
      name: "Front Door",
      online: true,
      capabilities: { motionDetection: true, humanDetection: true, liveView: true, snapshots: true, battery: false },
      motionRecordingEnabled: true,
      hasMotionZone: true,
      role: "front_door" as const,
    }
    const state = replay({
      visits: [visit()],
      events: [ding(START), event(at(START, 10), "device_offline", undefined, { deviceId: "backyard" }), human(at(END, 5))],
      ...window,
      deviceStates: { devices: [device] },
    })
    expect(state.visits[0]!.status).toBe("completed")
  })
})

describe("manual boundaries and sealing", () => {
  it("never re-derives a manual arrival or departure", () => {
    const manual = visit({
      status: "completed",
      arrival: { at: at(START, 5), source: "manual" },
      departure: { at: at(END, 0), source: "manual" },
    })
    const result = sweepVisits({
      visits: [manual],
      events: [ding(START)],
      openExceptions: [],
      tolerances: T,
      now: new Date(E + 10 * MIN),
    })
    expect(result.visits[0]).toBe(manual)
  })

  it("leaves settled visits alone long after their window", () => {
    const settled = visit({ status: "no_show" })
    const result = sweepVisits({
      visits: [settled],
      events: [ding(START)],
      openExceptions: [],
      tolerances: T,
      now: new Date(E + 200 * MIN),
    })
    expect(result.visits[0]).toBe(settled)
    expect(result.toRaise).toEqual([])
  })
})
