import { parseEvvCsv, formatEvvCsv } from "@visitproof/domain"
import { planTwoWeeks } from "@visitproof/ring-partner-sdk"
import { describe, expect, it } from "vitest"

import { evvRows, gpsNear, localWallTime } from "../evv"
import { CLIENTS } from "../fixtures"

const MIN = 60_000
const plans = planTwoWeeks({ startAt: Date.UTC(2026, 8, 15) })

const distanceMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
) => {
  const dLat = (a.lat - b.lat) * 111_320
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180)
  return Math.hypot(dLat, dLng)
}

describe("demo EVV fixture", () => {
  it("has one row per planned clock-in: 84 minus 4 no-shows minus 8 missing", () => {
    expect(evvRows(plans)).toHaveLength(72)
  })

  it("comes from the plan, not the engine: contradicted rows are early and far from home", () => {
    const rows = evvRows(plans)
    const parsed = parseEvvCsv(formatEvvCsv(rows), {
      agencyId: "a1",
      now: new Date(),
      timeZone: "America/New_York",
    })
    expect(parsed.errors).toEqual([])
    const withClockIn = plans.filter((plan) => plan.evv.clockInAt !== null)
    parsed.records.forEach((record, index) => {
      const plan = withClockIn[index]!
      expect(
        Math.abs(Date.parse(record.clockIn) - plan.evv.clockInAt!)
      ).toBeLessThan(MIN)
      const away = distanceMeters(
        { lat: record.lat!, lng: record.lng! },
        CLIENTS[plan.clientId]!.home
      )
      if (plan.evv.behavior === "contradicted")
        expect(away).toBeGreaterThan(1_500)
      else expect(away).toBeLessThan(100)
    })
    expect(
      withClockIn.filter((plan) => plan.evv.behavior === "contradicted")
    ).toHaveLength(6)
  })

  it("places GPS fixes at the requested distance", () => {
    const home = { lat: 39.9612, lng: -82.9988 }
    expect(distanceMeters(gpsNear(home, 40, "k"), home)).toBeCloseTo(40, -1)
    expect(distanceMeters(gpsNear(home, 2_500, "k"), home)).toBeGreaterThan(
      2_400
    )
  })

  it("writes agency-local wall-clock times", () => {
    expect(localWallTime(Date.UTC(2026, 9, 1, 12, 3))).toBe("2026-10-01 08:03")
  })
})
