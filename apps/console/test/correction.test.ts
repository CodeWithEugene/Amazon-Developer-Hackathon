import { describe, expect, it } from "vitest"

import { correctionText, planCorrection } from "@/lib/store/correction"
import { ValidationError } from "@/lib/store/errors"

import { TZ, visit } from "./fixtures"

const start = new Date("2026-09-14T13:00:00Z") // 9:00 AM ET
const now = new Date("2026-09-20T12:00:00Z")
const noShow = visit("v1", "c1", "g1", start, {
  status: "no_show",
  arrival: undefined,
  departure: undefined,
})

describe("planCorrection", () => {
  it("reads agency-local wall times on the visit's own day", () => {
    const plan = planCorrection(noShow, { arrivalLocal: "09:05", departureLocal: "11:02" }, TZ, now)
    expect(plan).toEqual({
      visitDay: "2026-09-14",
      arrivalAt: "2026-09-14T13:05:00.000Z",
      departureAt: "2026-09-14T15:02:00.000Z",
    })
  })

  it("rejects a departure before the arrival", () => {
    expect(() =>
      planCorrection(noShow, { arrivalLocal: "11:00", departureLocal: "10:00" }, TZ, now)
    ).toThrow(ValidationError)
  })

  it("rejects a departure before the observed arrival", () => {
    const observed = visit("v2", "c1", "g1", start, { departure: undefined })
    expect(() => planCorrection(observed, { departureLocal: "08:30" }, TZ, now)).toThrow(
      "The departure must be after the arrival."
    )
  })

  it("rejects instants outside the visit day", () => {
    expect(() =>
      planCorrection(noShow, { arrivalAt: "2020-01-01T00:00:00Z" }, TZ, now)
    ).toThrow(/visit day/)
  })

  it("rejects times in the future", () => {
    expect(() =>
      planCorrection(noShow, { arrivalLocal: "09:05" }, TZ, new Date("2026-09-14T12:00:00Z"))
    ).toThrow(/future/)
  })

  it("requires at least one time", () => {
    expect(() => planCorrection(noShow, {}, TZ, now)).toThrow(ValidationError)
  })

  it("describes the correction in agency time without dashes", () => {
    const plan = planCorrection(noShow, { arrivalLocal: "09:05" }, TZ, now)
    const text = correctionText(plan, "traffic", TZ)
    expect(text).toContain("arrival 9:05 AM ET")
    expect(text).toContain("Traffic Or Transit Delay")
    expect(text).not.toMatch(/[–—]/)
  })
})
