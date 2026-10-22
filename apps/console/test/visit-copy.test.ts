import { describe, expect, it } from "vitest"

import { formatTime } from "@/lib/format"
import { caregiverVisit } from "@/lib/views/caregiver"
import { reconRow } from "@/lib/views/compliance"
import { clockInSummary, doorSummary, formatDeltaLines, formatDeltaMinutes } from "@/lib/views/visit-copy"

import { TZ, visit } from "./fixtures"

const start = new Date("2026-09-20T12:08:00Z") // 8:08 AM ET
const arrived = "2026-09-20T12:08:00Z"
const left = "2026-09-20T14:02:00Z"
const DASHES = /[–—]/

describe("time copy carries the agency zone", () => {
  it("formats a lone time with ET and words for a missing one", () => {
    expect(formatTime(arrived, TZ)).toBe("8:08 AM ET")
    expect(formatTime(undefined, TZ)).toBe("not observed")
    expect(formatTime(undefined, TZ, "None")).toBe("None")
  })

  it("writes the door line as natural copy", () => {
    expect(doorSummary(arrived, undefined, TZ)).toBe("Door: arrived 8:08 AM ET, departure not observed.")
    expect(doorSummary(arrived, left, TZ)).toBe("Door: arrived 8:08 AM ET, left 10:02 AM ET.")
    expect(doorSummary(undefined, left, TZ)).toBe("Door: arrival not observed, left 10:02 AM ET.")
    expect(doorSummary(undefined, undefined, TZ)).toBe("Door: no arrival or departure observed.")
  })

  it("writes the clock-in line as natural copy", () => {
    expect(clockInSummary(undefined, TZ)).toBe("Clock-in: none recorded.")
    expect(clockInSummary(arrived, TZ)).toBe("Clock-in: 8:08 AM ET.")
  })

  it("formats signed minute deltas", () => {
    expect(formatDeltaMinutes(12.4)).toBe("+12 min")
    expect(formatDeltaMinutes(-3)).toBe("-3 min")
    expect(formatDeltaMinutes(0)).toBe("0 min")
    expect(formatDeltaMinutes(undefined)).toBe("None")
  })

  it("never renders 'In None' or 'Out None' in the delta cell", () => {
    const clock = { clockIn: arrived, clockOut: left }
    expect(formatDeltaLines({ ...clock, inMin: 12, outMin: -3, doorDeparture: left })).toEqual(["In +12 min", "Out -3 min"])
    expect(formatDeltaLines({ clockIn: arrived, inMin: 5, doorDeparture: left })).toEqual(["In +5 min", "Out: no clock-out"])
    expect(formatDeltaLines({ ...clock, inMin: 5 })).toEqual(["In +5 min", "Out: no door departure to compare"])
    expect(formatDeltaLines({})).toEqual(["No clock data"])
  })

  it("blames the missing door time, not the clock, when a clock-in has nothing to compare", () => {
    expect(formatDeltaLines({ clockIn: arrived, clockOut: left })).toEqual([
      "In: no door arrival to compare",
      "Out: no door departure to compare",
    ])
    expect(formatDeltaLines({ clockIn: arrived, clockOut: left, doorDeparture: left })).toEqual([
      "In: no door arrival to compare",
      "Out: not compared without a door arrival",
    ])
  })
})

describe("caregiver history copy", () => {
  it("never reads 'to not observed' or a bare 'none'", () => {
    const v = visit("v1", "c1", "g1", start, { departure: undefined, reconciliation: undefined })
    const row = caregiverVisit(v, "Grace Okoro", TZ)
    const line = `${row.window}. ${row.doorSummary} ${row.clockInSummary}`
    expect(line).toBe(
      "8:08 AM to 10:08 AM ET. Door: arrived 8:08 AM ET, departure not observed. Clock-in: none recorded."
    )
    expect(line).not.toMatch(/to not observed|Clock-in none/)
    expect(row.doorArrival).toBe("8:08 AM ET")
    expect(line).not.toMatch(DASHES)
  })
})

describe("compliance reconciliation row", () => {
  it("shows ET on every door and clock time, like the window", () => {
    const v = visit("v1", "c1", "g1", start, {
      reconciliation: {
        outcome: "corroborated_with_variance",
        clockIn: "2026-09-20T12:20:00Z",
        clockOut: "2026-09-20T14:00:00Z",
        deltaArrivalMin: 12,
        deltaDepartureMin: -2,
      },
    })
    const row = reconRow(v, { client: "Grace Okoro", caregiver: "Amara Okafor" }, TZ)
    expect(row.window).toBe("8:08 AM to 10:08 AM ET")
    expect(row.doorArrival).toBe("8:08 AM ET")
    expect(row.doorDeparture).toBe("10:08 AM ET")
    expect(row.clockIn).toBe("8:20 AM ET")
    expect(row.clockOut).toBe("10:00 AM ET")
    expect(row.deltaIn).toBe("+12 min")
    expect(row.deltaOut).toBe("-2 min")
    expect(row.deltaLines).toEqual(["In +12 min", "Out -2 min"])
  })

  it("does not say there is no clock data on a contradicted or missing_door visit", () => {
    for (const outcome of ["contradicted", "missing_door"] as const) {
      const v = visit("v3", "c1", "g1", start, {
        arrival: undefined,
        reconciliation: { outcome, clockIn: "2026-09-20T12:10:00Z", clockOut: "2026-09-20T14:00:00Z" },
      })
      const row = reconRow(v, { client: "Grace Okoro", caregiver: "Amara Okafor" }, TZ)
      expect(row.clockIn).toBe("8:10 AM ET")
      expect(row.deltaLines).toEqual(["In: no door arrival to compare", "Out: not compared without a door arrival"])
      expect(row.deltaLines.join(" ")).not.toMatch(/No clock data|not recorded|[–—]/)
    }
  })

  it("says the door departure is missing when the clock-out exists", () => {
    const v = visit("v4", "c1", "g1", start, {
      departure: undefined,
      reconciliation: {
        outcome: "corroborated",
        clockIn: "2026-09-20T12:10:00Z",
        clockOut: "2026-09-20T14:00:00Z",
        deltaArrivalMin: 2,
      },
    })
    const row = reconRow(v, { client: "Grace Okoro", caregiver: "Amara Okafor" }, TZ)
    expect(row.clockOut).toBe("10:00 AM ET")
    expect(row.deltaLines).toEqual(["In +2 min", "Out: no door departure to compare"])
  })

  it("says what is missing in sentence case", () => {
    const v = visit("v2", "c1", "g1", start, { arrival: undefined, departure: undefined, reconciliation: undefined })
    const row = reconRow(v, { client: "Grace Okoro", caregiver: "Amara Okafor" }, TZ)
    expect([row.doorArrival, row.doorDeparture]).toEqual(["Not observed", "Not observed"])
    expect([row.clockIn, row.clockOut, row.deltaIn, row.deltaOut]).toEqual(["None", "None", "None", "None"])
    expect(row.deltaLines).toEqual(["No clock data"])
    expect(row.outcome).toBe("pending")
  })
})
