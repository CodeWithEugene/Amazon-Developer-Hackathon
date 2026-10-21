import { describe, expect, it } from "vitest"

import { localDateKey, readableTimestamp, zonedWallTimeToEpoch } from "./time-zone"

const iso = (ms: number) => new Date(ms).toISOString()
const NY = "America/New_York"

describe("time zone helpers", () => {
  it("maps New York wall time to UTC across daylight saving", () => {
    expect(iso(zonedWallTimeToEpoch({ year: 2026, month: 9, day: 28 }, 8, 0, NY))).toBe("2026-09-28T12:00:00.000Z")
    expect(iso(zonedWallTimeToEpoch({ year: 2026, month: 11, day: 1 }, 8, 0, NY))).toBe("2026-11-01T13:00:00.000Z")
    expect(iso(zonedWallTimeToEpoch({ year: 2026, month: 11, day: 2 }, 18, 30, NY))).toBe("2026-11-02T23:30:00.000Z")
    expect(iso(zonedWallTimeToEpoch({ year: 2026, month: 3, day: 8 }, 18, 0, NY))).toBe("2026-03-08T22:00:00.000Z")
  })

  it("formats Ring's timestamp_readable and the local date key", () => {
    expect(readableTimestamp(1_786_715_596_787, "America/Chicago")).toBe("2026-08-14 08:53:16")
    expect(localDateKey(Date.UTC(2026, 8, 28, 2), NY)).toBe("2026-09-27")
  })
})
