import { describe, expect, it } from "vitest"

import { pickCaregiverPersona } from "@/lib/store/persona"
import { exceptionGroup } from "@/lib/views/grouping"
import { chooseTodayAlert, dayHeadline, familyStatus } from "@/lib/views/family-summary"

import { caregiver, exception, nineAmEastern, visit } from "./fixtures"

const now = new Date("2026-09-20T18:00:00Z")

describe("exception board grouping", () => {
  it("splits cards into Today, Earlier This Week, Older, and Snoozed", () => {
    expect(exceptionGroup("2026-09-20", "2026-09-20", false)).toBe("today")
    expect(exceptionGroup("2026-09-14", "2026-09-20", false)).toBe("week")
    expect(exceptionGroup("2026-09-13", "2026-09-20", false)).toBe("older")
    expect(exceptionGroup(null, "2026-09-20", false)).toBe("older")
    expect(exceptionGroup("2026-09-20", "2026-09-20", true)).toBe("snoozed")
  })
})

describe("family daily message", () => {
  const today = visit("v_today", "c1", "g1", nineAmEastern(now, 0))
  const second = visit("v_today_2", "c1", "g1", new Date(nineAmEastern(now, 0).getTime() + 4 * 3_600_000))

  it("summarizes every visit of the day in one headline", () => {
    expect(dayHeadline([today, second], now)).toBe("The caregiver came for both visits")
    const third = { ...second, id: "v_today_3" }
    expect(dayHeadline([today, second, third], now)).toBe("The caregiver came for all three visits")
    expect(dayHeadline([today, { ...second, arrival: undefined }], now)).toBe("1 of 2 visits observed so far")
    expect(dayHeadline([], now)).toBe("No visit is scheduled")
  })

  it("shows at most one alert, destructive only for a no-show", () => {
    const late = exception(today, "late_arrival")
    const early = exception(second, "early_departure")
    const ids = new Set([today.id, second.id])
    expect(chooseTodayAlert([late, early], ids)).toMatchObject({ tone: "warning", exception: { kind: "early_departure" } })
    const noShow = exception(second, "no_show")
    expect(chooseTodayAlert([late, noShow], ids)?.tone).toBe("destructive")
    const earlier = exception(visit("v_old", "c1", "g1", nineAmEastern(now, 3)), "no_show")
    expect(chooseTodayAlert([earlier], ids)).toBeNull()
  })

  it("never shows Unobservable next to an observed arrival", () => {
    expect(familyStatus({ ...today, status: "unobservable" })).toBe("completed")
  })

  it("says the departure was not observed once an unobservable visit's window has passed", () => {
    const arrivedOnly = { ...today, status: "unobservable" as const, departure: undefined }
    const afterEnd = new Date(Date.parse(today.scheduledEnd) + 60_000)
    const duringVisit = new Date(Date.parse(today.scheduledEnd) - 60_000)
    expect(familyStatus(arrivedOnly, afterEnd)).toBe("departure_not_observed")
    expect(familyStatus(arrivedOnly, duringVisit)).toBe("in_progress")
  })
})

describe("caregiver persona", () => {
  it("prefers the caregiver with a missing clock-in with door presence", () => {
    const visits = [
      visit("v1", "c1", "g_busy", nineAmEastern(now, 1)),
      visit("v2", "c1", "g_busy", nineAmEastern(now, 2)),
      visit("v3", "c1", "g_dispute", nineAmEastern(now, 1), {
        reconciliation: { outcome: "missing_clock_in" },
      }),
    ]
    const roster = [caregiver("g_busy", "Busy"), caregiver("g_dispute", "Dispute")]
    expect(pickCaregiverPersona(visits, roster)).toBe("g_dispute")
    expect(pickCaregiverPersona(visits.slice(0, 2), roster)).toBe("g_busy")
  })
})
