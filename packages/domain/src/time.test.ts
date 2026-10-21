import { describe, expect, it } from "vitest"

import {
  formatLocalDate,
  formatLocalTime,
  localDateKey,
  zoneAbbreviation,
  zonedTimeToIso,
} from "./time"

const NY = "America/New_York"

describe("formatLocalTime", () => {
  it("renders 12-hour agency-local time with the zone abbreviation", () => {
    expect(formatLocalTime("2026-10-01T12:04:00.000Z", NY)).toBe("8:04 AM ET")
    expect(formatLocalTime("2026-10-01T17:30:00.000Z", NY)).toBe("1:30 PM ET")
    expect(formatLocalTime("2026-10-01T12:04:00.000Z", "UTC")).toBe("12:04 PM UTC")
  })

  it("follows the DST change on 2026-11-01 (EDT to EST)", () => {
    // 9:00 AM local on both sides of the fall-back boundary
    expect(formatLocalTime("2026-10-31T13:00:00.000Z", NY)).toBe("9:00 AM ET")
    expect(formatLocalTime("2026-11-02T14:00:00.000Z", NY)).toBe("9:00 AM ET")
    // The repeated 1:30 AM hour appears twice, an hour apart in UTC
    expect(formatLocalTime("2026-11-01T05:30:00.000Z", NY)).toBe("1:30 AM ET")
    expect(formatLocalTime("2026-11-01T06:30:00.000Z", NY)).toBe("1:30 AM ET")
  })

  it("follows the spring-forward change on 2026-03-08", () => {
    expect(formatLocalTime("2026-03-08T06:59:00.000Z", NY)).toBe("1:59 AM ET")
    expect(formatLocalTime("2026-03-08T07:00:00.000Z", NY)).toBe("3:00 AM ET")
  })

  it("rejects invalid timestamps and zones", () => {
    expect(() => formatLocalTime("not a date", NY)).toThrow(RangeError)
    expect(() => formatLocalTime("2026-10-01T12:00:00.000Z", "Mars/Olympus")).toThrow(RangeError)
  })
})

describe("zoneAbbreviation", () => {
  it("uses the compact generic label when one exists", () => {
    expect(zoneAbbreviation("2026-07-01T12:00:00.000Z", NY)).toBe("ET")
    expect(zoneAbbreviation("2026-07-01T12:00:00.000Z", "America/Los_Angeles")).toBe("PT")
  })

  it("falls back to the offset form for zones without a compact label", () => {
    expect(zoneAbbreviation("2026-07-01T12:00:00.000Z", "Asia/Kathmandu")).toMatch(/^GMT\+5:45$/)
  })
})

describe("localDateKey", () => {
  it("is the calendar date in the agency zone, not the UTC date", () => {
    // 11:30 PM Eastern on Sept 30 is already Oct 1 in UTC
    expect(localDateKey("2026-10-01T03:30:00.000Z", NY)).toBe("2026-09-30")
    expect(localDateKey("2026-10-01T04:30:00.000Z", NY)).toBe("2026-10-01")
  })

  it("rolls over at local midnight on both sides of the DST change", () => {
    expect(localDateKey("2026-11-01T03:59:00.000Z", NY)).toBe("2026-10-31")
    expect(localDateKey("2026-11-01T04:00:00.000Z", NY)).toBe("2026-11-01")
    expect(localDateKey("2026-11-02T04:59:00.000Z", NY)).toBe("2026-11-01")
    expect(localDateKey("2026-11-02T05:00:00.000Z", NY)).toBe("2026-11-02")
  })
})

describe("formatLocalDate", () => {
  it("renders the local calendar date", () => {
    expect(formatLocalDate("2026-10-01T03:30:00.000Z", NY)).toBe("Wed, Sep 30, 2026")
    expect(formatLocalDate("2026-11-01T12:00:00.000Z", NY)).toBe("Sun, Nov 1, 2026")
  })
})

describe("zonedTimeToIso", () => {
  it("converts local wall-clock times to UTC across the DST change", () => {
    expect(zonedTimeToIso("2026-10-31", 9, 0, NY)).toBe("2026-10-31T13:00:00.000Z")
    expect(zonedTimeToIso("2026-11-02", 9, 0, NY)).toBe("2026-11-02T14:00:00.000Z")
    expect(zonedTimeToIso("2026-11-01", 1, 30, NY)).toBe("2026-11-01T05:30:00.000Z")
    expect(zonedTimeToIso("2026-10-01", 0, 0, "UTC")).toBe("2026-10-01T00:00:00.000Z")
  })

  it("round-trips through localDateKey and formatLocalTime", () => {
    const iso = zonedTimeToIso("2026-03-09", 8, 15, NY)
    expect(localDateKey(iso, NY)).toBe("2026-03-09")
    expect(formatLocalTime(iso, NY)).toBe("8:15 AM ET")
  })

  it("rejects malformed input", () => {
    expect(() => zonedTimeToIso("2026/10/01", 9, 0, NY)).toThrow(RangeError)
    expect(() => zonedTimeToIso("2026-10-01", 24, 0, NY)).toThrow(RangeError)
    expect(() => zonedTimeToIso("2026-10-01", 9, 60, NY)).toThrow(RangeError)
  })
})
