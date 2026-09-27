import { describe, expect, it } from "vitest"

import { buildNarrative, validateNarrative } from "./narratives"
import type { Visit } from "./types"

const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
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
    scheduledStart: "2026-10-01T06:00:00.000Z",
    scheduledEnd: "2026-10-01T08:00:00.000Z",
    status: "completed",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

describe("buildNarrative", () => {
  const now = new Date("2026-10-01T09:00:00.000Z")

  it("describes an on-time completed visit", () => {
    const narrative = buildNarrative({
      visit: visit({
        arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
        departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
        reconciliation: { outcome: "corroborated" },
      }),
      now,
    })
    expect(narrative.provenance).toBe("template")
    expect(narrative.text).toContain("06:02")
    expect(narrative.text).toContain("08:05")
    expect(narrative.text).toContain("clock-in")
  })

  it("describes a no-show without naming anyone", () => {
    const narrative = buildNarrative({ visit: visit({ status: "no_show" }), now })
    expect(narrative.text).toContain("No caregiver arrival was observed")
  })

  it("describes unobservable visits", () => {
    const narrative = buildNarrative({
      visit: visit({
        observability: { state: "unobservable", reasons: ["device_offline"] },
      }),
      now,
    })
    expect(narrative.text).toContain("could not be observed")
  })

  it("flags ambiguous visits for review", () => {
    const narrative = buildNarrative({ visit: visit({ status: "ambiguous" }), now })
    expect(narrative.text).toContain("review")
  })
})

describe("validateNarrative", () => {
  it("enforces times, length, and name rules", () => {
    const v = visit({ arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })
    const good = buildNarrative({ visit: v, now: new Date("2026-10-01T09:00:00.000Z") })
    expect(validateNarrative(good.text, v)).toEqual({
      mustContainTimes: true,
      under60Words: true,
      noOtherNames: true,
    })
    expect(validateNarrative("Priya Alvarez arrived", v).noOtherNames).toBe(false)
    expect(validateNarrative("no time mentioned", v).mustContainTimes).toBe(false)
    const long = `${"word ".repeat(60)} 06:02`
    expect(validateNarrative(long, v).under60Words).toBe(false)
  })

  it("treats sentence-initial capitals as grammar, but still flags names mid-sentence", () => {
    const v = visit({ arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })
    const withDeparture = buildNarrative({
      visit: visit({
        arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
        departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
      }),
      now: new Date("2026-10-01T09:00:00.000Z"),
    })
    // "They left at 08:05" — the pronoun opens a sentence and must pass.
    expect(withDeparture.text).toContain("They left")
    expect(validateNarrative(withDeparture.text, v).noOtherNames).toBe(true)
    expect(validateNarrative("caregiver Priya arrived at 06:02", v).noOtherNames).toBe(false)
    // The caregiver's own name is allowed when the writer supplies it.
    expect(
      validateNarrative("Maria arrived at 06:02 on time.", v, "Maria Santos").noOtherNames
    ).toBe(true)
  })
})
