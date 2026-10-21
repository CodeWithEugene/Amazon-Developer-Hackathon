import { describe, expect, it } from "vitest"

import { ConflictError } from "@/lib/store/errors"
import { effectiveState, resolved, snoozed } from "@/lib/store/exception-state"

import { exception, nineAmEastern, visit } from "./fixtures"

const now = new Date("2026-09-20T15:00:00Z")
const base = exception(visit("v1", "c1", "g1", nineAmEastern(now, 0)), "late_no_arrival")

describe("exception state machine", () => {
  it("treats a snooze as open again once snoozeUntil has passed", () => {
    const later = snoozed(base, 10, now)
    expect(later.state).toBe("snoozed")
    expect(effectiveState(later, now)).toBe("snoozed")
    expect(effectiveState(later, new Date(now.getTime() + 11 * 60_000))).toBe("open")
  })

  it("refuses to snooze a resolved exception", () => {
    const done = resolved(base, { by: "scheduler", reason: "traffic" }, now)
    expect(() => snoozed(done, 10, now)).toThrow(ConflictError)
  })

  it("refuses to snooze an exception that is still snoozed", () => {
    expect(() => snoozed(snoozed(base, 10, now), 10, now)).toThrow(ConflictError)
  })

  it("never overwrites an earlier resolution", () => {
    const done = resolved(base, { by: "scheduler", reason: "traffic" }, now)
    expect(() => resolved(done, { by: "compliance", reason: "second" }, now)).toThrow(ConflictError)
    expect(done.resolution?.reason).toBe("traffic")
  })

  it("resolves a snoozed exception and clears the snooze", () => {
    const done = resolved(snoozed(base, 10, now), { by: "scheduler", reason: "traffic" }, now)
    expect(done.state).toBe("resolved")
    expect(done.snoozeUntil).toBeUndefined()
    expect(done.version).toBe(base.version + 2)
  })
})
