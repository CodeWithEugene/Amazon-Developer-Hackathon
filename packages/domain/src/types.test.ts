import { describe, expect, it } from "vitest"

import {
  DEFAULT_TOLERANCES,
  doorEventSchema,
  exceptionKindSchema,
  visitSchema,
  visitStatusSchema,
} from "./types"

const audit = {
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  version: 1,
}

describe("domain types", () => {
  it("has the documented default tolerances", () => {
    expect(DEFAULT_TOLERANCES).toEqual({
      graceMin: 15,
      escalationMin: 45,
      earlyDepartureMin: 10,
      departureQuietMin: 10,
    })
  })

  it("parses a scheduled visit", () => {
    const visit = visitSchema.parse({
      ...audit,
      id: "v1",
      clientId: "c1",
      agencyId: "a1",
      caregiverId: "cg1",
      serviceCode: "T1019",
      date: "2026-10-01",
      scheduledStart: "2026-10-01T06:00:00.000Z",
      scheduledEnd: "2026-10-01T08:00:00.000Z",
      status: "scheduled",
      observability: { state: "observable", reasons: [] },
    })

    expect(visit.status).toBe("scheduled")
  })

  it("rejects an unknown visit status and exception kind", () => {
    expect(visitStatusSchema.safeParse("late").success).toBe(false)
    expect(exceptionKindSchema.safeParse("sleepy").success).toBe(false)
  })

  it("defaults componentIds on a door event", () => {
    const event = doorEventSchema.parse({
      ...audit,
      clientId: "c1",
      requestId: "req-1",
      timestampMs: 1786715596787,
      at: "2026-08-14T08:53:16.787Z",
      type: "motion",
      subType: "human",
      provenance: "emulated",
      rawPayloadHash: "abc",
    })

    expect(event.componentIds).toEqual([])
  })
})
