import { describe, expect, it } from "vitest"
import { DEMO_NOW, DEMO_REPO } from "../src/repo"
import {
  didTheCaregiverComeToday,
  exportEvidence,
  getVisitEvidence,
  getVisitStatus,
  listTodayExceptions,
  type ToolContext,
} from "../src/tools"

const context: ToolContext = { repo: DEMO_REPO, now: () => DEMO_NOW }

describe("didTheCaregiverComeToday", () => {
  it("answers yes with door times for a completed on-time visit", async () => {
    const result = await didTheCaregiverComeToday(
      { clientId: "client-okoro" },
      context,
    )
    expect(result.answer).toBe("yes")
    expect(result.spoken).toContain("Maria")
    expect(result.spoken).toContain("10:02 AM")
    expect(result.arrivalAt).toBe("2026-09-27T10:02:00Z")
  })

  it("answers no for a no-show visit", async () => {
    const result = await didTheCaregiverComeToday(
      { clientId: "client-alvarez" },
      context,
    )
    expect(result.answer).toBe("no")
    expect(result.spoken).toContain("did not see anyone")
  })

  it("answers not yet for a visit without arrival", async () => {
    const result = await didTheCaregiverComeToday(
      { clientId: "client-nakamura" },
      context,
    )
    expect(result.answer).toBe("yes")
    expect(result.spoken).toContain("later than scheduled")
  })

  it("answers unknown when no visit is scheduled", async () => {
    const result = await didTheCaregiverComeToday({ date: "2026-01-01" }, context)
    expect(result.answer).toBe("unknown")
    expect(result.spoken).toContain("No visit is scheduled")
  })

  it("handles an unknown client", async () => {
    const result = await didTheCaregiverComeToday(
      { clientId: "client-nobody" },
      context,
    )
    expect(result.answer).toBe("unknown")
    expect(result.spoken).toContain("could not find that client")
  })
})

describe("getVisitStatus", () => {
  it("returns status, times, and reconciliation summary", async () => {
    const result = await getVisitStatus(
      { visitId: "visit-okoro-today" },
      context,
    )
    expect(result.status).toBe("completed")
    expect(result.spoken).toContain("corroborated")
    expect(result.reconciliation?.outcome).toBe("corroborated")
  })

  it("resolves a visit by client and date", async () => {
    const result = await getVisitStatus(
      { clientId: "client-nakamura", date: "2026-09-27" },
      context,
    )
    expect(result.visitId).toBe("visit-nakamura-today")
    expect(result.status).toBe("arrived_late")
  })

  it("returns unknown spoken for a missing visit", async () => {
    const result = await getVisitStatus({ visitId: "visit-nope" }, context)
    expect(result.spoken).toBe("I could not find that visit.")
    expect(result.visitId).toBeUndefined()
  })
})

describe("listTodayExceptions", () => {
  it("ranks open exceptions by severity (no_show first)", async () => {
    const result = await listTodayExceptions({}, context)
    expect(result.count).toBe(2)
    expect(result.exceptions[0]?.kind).toBe("no_show")
    expect(result.exceptions[1]?.kind).toBe("late_arrival")
    expect(result.spoken).toContain("2 exceptions")
  })

  it("filters by state and handles none", async () => {
    const resolved = await listTodayExceptions({ state: "resolved" }, context)
    expect(resolved.count).toBe(0)
    expect(resolved.spoken).toContain("No resolved exceptions")
  })
})

describe("getVisitEvidence", () => {
  it("builds the three-column timeline with door events", async () => {
    const result = await getVisitEvidence(
      { visitId: "visit-okoro-today" },
      context,
    )
    expect(result.visitId).toBe("visit-okoro-today")
    const columns = new Set(result.timeline?.map((entry) => entry.column))
    expect(columns).toEqual(new Set(["observed", "reported", "resolved"]))
    expect(result.timeline?.some((entry) => entry.text.includes("ding"))).toBe(
      true,
    )
  })

  it("is unknown for a missing visit", async () => {
    const result = await getVisitEvidence({ visitId: "visit-nope" }, context)
    expect(result.timeline).toBeUndefined()
    expect(result.spoken).toBe("I could not find that visit.")
  })
})

describe("exportEvidence", () => {
  it("exports JSON with a checksum", async () => {
    const result = await exportEvidence(
      { visitId: "visit-okoro-today" },
      context,
    )
    expect(result.format).toBe("json")
    expect(result.entries).toBeGreaterThan(0)
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it("declines to export a missing visit", async () => {
    const result = await exportEvidence({ visitId: "visit-nope" }, context)
    expect(result.spoken).toContain("nothing was exported")
  })
})
