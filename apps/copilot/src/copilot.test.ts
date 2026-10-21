import { describe, expect, it } from "vitest"
import type { Exception, Visit } from "@visitproof/domain"
import {
  createOpsCopilot,
  parseIntent,
  resolveRange,
  type CopilotDataAccessor,
} from "./index"

const NOW = () => new Date("2026-10-14T12:00:00Z") // Wednesday

function visit(overrides: Partial<Visit>): Visit {
  return {
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    version: 1,
    id: "V1",
    clientId: "C1",
    agencyId: "A1",
    caregiverId: "CG1",
    serviceCode: "HPC",
    date: "2026-10-14",
    scheduledStart: "2026-10-14T06:00:00Z",
    scheduledEnd: "2026-10-14T08:00:00Z",
    status: "arrived_on_time",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

function exception(overrides: Partial<Exception>): Exception {
  return {
    createdAt: "2026-10-14T06:15:00Z",
    updatedAt: "2026-10-14T06:15:00Z",
    version: 1,
    id: "EXC-1",
    agencyId: "A1",
    visitId: "V1",
    clientId: "C1",
    kind: "late_no_arrival",
    state: "open",
    openedAt: "2026-10-14T06:15:00Z",
    ...overrides,
  }
}

// Late visits end as "completed": lateness comes from the door arrival.
const lateVisit = visit({
  id: "V-late",
  status: "completed",
  date: "2026-10-14",
  arrival: { at: "2026-10-14T06:22:00Z", source: "rule" },
})
const onTimeVisit = visit({
  id: "V-ontime",
  status: "arrived_late",
  date: "2026-10-14",
  arrival: { at: "2026-10-14T06:10:00Z", source: "rule" },
})
const noShowVisit = visit({
  id: "V-noshow",
  status: "no_show",
  date: "2026-10-13",
})
const unobservableVisit = visit({
  id: "V-unobs",
  status: "unobservable",
  date: "2026-10-13",
  observability: { state: "unobservable", reasons: ["device_offline"] },
})
const missingClockInVisit = visit({
  id: "V-mci",
  status: "completed",
  date: "2026-10-13",
  reconciliation: { outcome: "missing_clock_in" },
})
const okVisit = visit({ id: "V-ok", status: "completed" })

const openException = exception({
  id: "V-late#late_no_arrival",
  visitId: "V-late",
})

function makeAccessor(
  visits: readonly Visit[],
  exceptions: readonly Exception[],
): CopilotDataAccessor {
  return {
    async listVisits(filter) {
      return visits.filter(
        (v) =>
          v.date >= filter.from &&
          v.date <= filter.to &&
          (filter.statuses === undefined ||
            filter.statuses.includes(v.status)),
      )
    },
    async listExceptions(filter) {
      return exceptions.filter(
        (e) =>
          (filter.state === undefined || e.state === filter.state) &&
          (filter.from === undefined || e.openedAt.slice(0, 10) >= filter.from) &&
          (filter.to === undefined || e.openedAt.slice(0, 10) <= filter.to),
      )
    },
    async getVisit(id) {
      return visits.find((v) => v.id === id)
    },
    async getException(id) {
      return exceptions.find((e) => e.id === id)
    },
  }
}

describe("resolveRange", () => {
  it("defaults to today", () => {
    expect(resolveRange("who was late", NOW)).toEqual({
      from: "2026-10-14",
      to: "2026-10-14",
    })
  })

  it("resolves this week to Monday through today", () => {
    expect(resolveRange("no-shows this week", NOW)).toEqual({
      from: "2026-10-12",
      to: "2026-10-14",
    })
  })

  it("uses an explicit date", () => {
    expect(resolveRange("late on 2026-10-02", NOW)).toEqual({
      from: "2026-10-02",
      to: "2026-10-02",
    })
  })
})

describe("parseIntent", () => {
  it("maps late questions to list_late_visits", () => {
    const parsed = parseIntent("who was late today", NOW)
    expect(parsed.intent).toBe("who_was_late")
    expect(parsed.toolName).toBe("list_late_visits")
  })

  it("maps no-show questions to list_no_shows", () => {
    const parsed = parseIntent("show no-shows this week", NOW)
    expect(parsed.toolName).toBe("list_no_shows")
  })

  it("maps evidence questions to list_missing_evidence", () => {
    const parsed = parseIntent("which visits are missing evidence", NOW)
    expect(parsed.toolName).toBe("list_missing_evidence")
  })

  it("extracts an exception id in the minted visitId#kind format", () => {
    const parsed = parseIntent("explain exception V-late#late_no_arrival", NOW)
    expect(parsed.toolName).toBe("explain_exception")
    expect(parsed.args).toEqual({ exceptionId: "V-late#late_no_arrival" })
  })

  it("returns unknown for off-topic questions", () => {
    const parsed = parseIntent("what is the weather", NOW)
    expect(parsed.intent).toBe("unknown")
    expect(parsed.reasoning).toMatch(/no intent template matched/)
  })
})

describe("createOpsCopilot", () => {
  const accessor = makeAccessor(
    [lateVisit, onTimeVisit, noShowVisit, unobservableVisit, missingClockInVisit, okVisit],
    [openException],
  )
  const copilot = createOpsCopilot({ accessor, now: NOW })

  it("answers who was late today from the arrival time, with the query it ran", async () => {
    const answer = await copilot.ask("who was late today")
    expect(answer.tool).toBe("list_late_visits")
    expect(answer.answer).toBe("1 late arrival: a client, Wednesday 2:00 AM ET, 22 minutes late.")
    expect((answer.data as Visit[]).map((v) => v.id)).toEqual(["V-late"])
    expect(answer.query).toBe(
      "listVisits({ from: 2026-10-14, to: 2026-10-14 }) filtered to arrival later than scheduled start + 15 min",
    )
    expect(answer.reasoning).toMatch(/late/)
  })

  it("names clients and bounds the answer to five items", async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      visit({ id: `V-late-${index}`, clientId: "C1", status: "completed", arrival: { at: "2026-10-14T06:30:00Z", source: "rule" } }),
    )
    const named = createOpsCopilot({
      accessor: { ...makeAccessor(many, []), async getClient() { return { name: "Grace Okoro" } as never } },
      now: NOW,
    })
    const answer = await named.ask("who was late today")
    expect(answer.answer.startsWith("7 late arrivals: Grace, Wednesday 2:00 AM ET, 30 minutes late;")).toBe(true)
    expect(answer.answer).toContain("; and 2 more.")
    expect(answer.data).toHaveLength(7)
  })

  it("answers no-shows this week", async () => {
    const answer = await copilot.ask("show no-shows this week")
    expect(answer.tool).toBe("list_no_shows")
    expect(answer.answer).toContain("1 no-show")
    expect((answer.data as Visit[]).map((v) => v.id)).toEqual(["V-noshow"])
    expect(answer.query).toContain("from: 2026-10-12")
  })

  it("answers which visits are missing evidence, including missing clock-ins", async () => {
    const answer = await copilot.ask("which visits are missing evidence this week")
    expect(answer.tool).toBe("list_missing_evidence")
    const ids = (answer.data as Visit[]).map((v) => v.id).sort()
    expect(ids).toEqual(["V-mci", "V-unobs"])
  })

  it("explains an exception by id", async () => {
    const answer = await copilot.ask("explain exception V-late#late_no_arrival")
    expect(answer.tool).toBe("explain_exception")
    expect(answer.answer).toContain("late no arrival exception")
    expect(answer.answer).toContain("Someone arrived at the door at 2:22 AM ET")
    expect(answer.query).toContain("getVisit(V-late)")
  })

  it("explains the latest open exception when no id is given", async () => {
    const answer = await copilot.ask("explain this exception")
    expect(answer.tool).toBe("explain_exception")
    expect(answer.query).toContain("listExceptions({ state: open })")
    expect(answer.answer).toContain("late no arrival exception")
  })

  it("declines gracefully for unknown questions", async () => {
    const answer = await copilot.ask("what is the weather")
    expect(answer.tool).toBeNull()
    expect(answer.query).toBeNull()
    expect(answer.answer).toMatch(/I can answer/)
  })

  it("surfaces accessor failures without throwing", async () => {
    const broken = createOpsCopilot({
      accessor: {
        ...accessor,
        async listVisits() {
          throw new Error("table unavailable")
        },
      },
      now: NOW,
    })
    const answer = await broken.ask("who was late today")
    expect(answer.answer).toContain("table unavailable")
  })
})
