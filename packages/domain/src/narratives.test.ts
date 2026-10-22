import { describe, expect, it } from "vitest"

import { buildNarrative, narrativeTime, validateNarrative } from "./narratives"
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

describe("narratives in the agency time zone (contract C1)", () => {
  const now = new Date("2026-10-01T16:00:00.000Z")
  const eastern = visit({
    scheduledStart: "2026-10-01T13:00:00.000Z",
    scheduledEnd: "2026-10-01T15:00:00.000Z",
    arrival: { at: "2026-10-01T13:04:00.000Z", source: "rule" },
    departure: { at: "2026-10-01T15:00:00.000Z", source: "rule" },
    status: "completed",
    reconciliation: { outcome: "corroborated_with_variance" },
  })

  it("renders agency-local 12-hour times with the zone abbreviation", () => {
    const narrative = buildNarrative({ visit: eastern, now, timeZone: "America/New_York" })
    expect(narrative.text).toContain("arrived at 9:04 AM ET, 4 minutes after the scheduled time (9:00 AM ET)")
    expect(narrative.text).toContain("left at 11:00 AM ET, on time (11:00 AM ET)")
    expect(narrative.text).not.toMatch(/[–—]/)
    const rules = validateNarrative(narrative.text, eastern, undefined, { timeZone: "America/New_York" })
    expect(rules).toEqual({ mustContainTimes: true, under60Words: true, noOtherNames: true })
  })

  it("labels every time with the agency zone, matching the rest of the app", () => {
    const morning = { ...eastern, arrival: { at: "2026-10-01T12:04:00.000Z", source: "rule" as const } }
    const text = buildNarrative({ visit: morning, now, timeZone: "America/New_York" }).text
    expect(text).toContain("A caregiver arrived at 8:04 AM ET, 56 minutes before the scheduled time (9:00 AM ET).")
    expect(narrativeTime("2026-10-01T12:04:00.000Z", { timeZone: "America/New_York" })).toBe("8:04 AM ET")
    expect(narrativeTime("2026-12-01T13:04:00.000Z", { timeZone: "America/New_York" })).toBe("8:04 AM ET")
    expect(narrativeTime("2026-10-01T15:04:00.000Z", { timeZone: "America/Los_Angeles" })).toBe("8:04 AM PT")
    const clockTimes = text.match(/\d{1,2}:\d{2}(?: [AP]M [A-Z]+)?/g) ?? []
    expect(clockTimes).toHaveLength(4)
    expect(clockTimes.every((time) => / [AP]M ET$/.test(time))).toBe(true)
  })

  it("rejects a narrative whose arrival time lacks the zone label", () => {
    const options = { timeZone: "America/New_York" }
    expect(validateNarrative("A caregiver arrived at 9:04 AM.", eastern, undefined, options).mustContainTimes).toBe(false)
    expect(validateNarrative("A caregiver arrived at 9:04 AM ET.", eastern, undefined, options).mustContainTimes).toBe(true)
  })

  it("keeps the legacy UTC form when no time zone is given", () => {
    const narrative = buildNarrative({ visit: eastern, now })
    expect(narrative.text).toContain("arrived at 13:04")
    expect(validateNarrative(narrative.text, eastern).mustContainTimes).toBe(true)
    expect(validateNarrative(narrative.text, eastern, undefined, { timeZone: "America/New_York" }).mustContainTimes).toBe(
      false
    )
  })

  it("covers the remaining reconciliation phrases and a departure that was not observed", () => {
    const phrases = (["contradicted", "missing_clock_in", "missing_door", "missing_both", "unobservable", "pending"] as const).map(
      (outcome) => buildNarrative({ visit: { ...eastern, reconciliation: { outcome } }, now }).text
    )
    expect(phrases.every((text) => text.length > 0)).toBe(true)
    const lingering = buildNarrative({
      visit: { ...eastern, departure: undefined, status: "departure_not_observed" },
      now,
      timeZone: "America/New_York",
    })
    expect(lingering.text).toContain("No departure was observed")
    const early = buildNarrative({ visit: { ...eastern, arrival: { at: "2026-10-01T12:59:00.000Z", source: "rule" } }, now })
    expect(early.text).toContain("1 minute before")
  })
})

describe("narrative minute deltas", () => {
  it("compares the displayed minutes, so seconds never contradict the shown time", () => {
    const base: Visit = {
      id: "v1",
      clientId: "c1",
      agencyId: "a1",
      caregiverId: "cg1",
      serviceCode: "T1019",
      date: "2026-10-01",
      scheduledStart: "2026-10-01T20:00:00.000Z",
      scheduledEnd: "2026-10-01T22:00:00.000Z",
      status: "completed",
      observability: { state: "observable", reasons: [] },
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      version: 1,
    }
    const text = buildNarrative({
      visit: { ...base, arrival: { at: "2026-10-01T20:00:40.000Z", source: "rule" } },
      now: new Date("2026-10-01T23:00:00.000Z"),
      timeZone: "America/New_York",
    }).text
    expect(text).toContain("A caregiver arrived at 4:00 PM ET, on time (4:00 PM ET).")
  })
})
