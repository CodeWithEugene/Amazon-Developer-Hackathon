import { describe, expect, it } from "vitest"

import {
  addDaysToKey,
  formatLocalTime,
  formatLocalTimeZoned,
  localDateKey,
  localWallTimeToIso,
  zoneAbbreviation,
  zoneDescription,
} from "@/lib/time"

const TZ = "America/New_York"

describe("agency time zone helpers", () => {
  it("renders 12-hour local times with the zone abbreviation", () => {
    expect(formatLocalTime("2026-09-14T13:04:00Z", TZ)).toBe("9:04 AM")
    expect(formatLocalTimeZoned("2026-09-14T13:04:00Z", TZ)).toBe("9:04 AM ET")
    expect(zoneAbbreviation("2026-09-14T13:04:00Z", TZ)).toBe("ET")
  })

  it("describes the zone in words instead of the IANA name", () => {
    expect(zoneDescription("2026-09-14T13:04:00Z", TZ)).toBe("ET (Eastern Time)")
    expect(zoneDescription("2026-09-14T13:04:00Z", TZ)).not.toContain("/")
  })

  it("computes today as the agency-local calendar date", () => {
    // 02:30Z on the 15th is still the evening of the 14th in New York.
    expect(localDateKey("2026-09-15T02:30:00Z", TZ)).toBe("2026-09-14")
    expect(localDateKey("2026-09-15T05:30:00Z", TZ)).toBe("2026-09-15")
  })

  it("converts agency wall time to UTC across the DST change", () => {
    expect(localWallTimeToIso("2026-09-14", "09:00", TZ)).toBe("2026-09-14T13:00:00.000Z")
    expect(localWallTimeToIso("2026-11-02", "09:00", TZ)).toBe("2026-11-02T14:00:00.000Z")
  })

  it("rejects malformed wall times", () => {
    expect(() => localWallTimeToIso("2026-09-14", "25:00", TZ)).toThrow(RangeError)
  })

  it("adds calendar days to a date key", () => {
    expect(addDaysToKey("2026-09-01", -1)).toBe("2026-08-31")
    expect(addDaysToKey("2026-10-31", 2)).toBe("2026-11-02")
  })
})
