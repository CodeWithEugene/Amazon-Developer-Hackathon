import { describe, expect, it } from "vitest"
import { verifyChain } from "@visitproof/domain"

import type { Principal } from "../src/auth"
import { fixtureSeed } from "../src/fixtures"
import { createFixtureRepository, DEMO_NOW } from "../src/repo"
import { DEMO_LEDGER_SIGNER } from "../src/signer"
import {
  acknowledgeException,
  addVisitNote,
  explainVisit,
  getClientSummary,
  getVisitStatus,
  listExceptions,
  listVisits,
  type ToolContext,
} from "../src/tools"

const family = (clientId: string): Principal => ({ kind: "family", subject: `demo:${clientId}`, clientId })

const contextFor = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  repo: createFixtureRepository(),
  now: () => DEMO_NOW,
  signer: DEMO_LEDGER_SIGNER,
  ...overrides,
})

describe("get_visit_status", () => {
  it("describes the door as someone and names the caregiver only from the clock-in", async () => {
    const result = await getVisitStatus({ clientId: "cli_okoro" }, contextFor())
    expect(result.answer).toBe("yes")
    expect(result.spoken).toContain("someone arrived at the door at 8:04 AM ET and left at 9:58 AM ET")
    expect(result.spoken).toContain("Amara Okafor clocked in at 8:06 AM ET")
    expect(result.spoken).not.toMatch(/Amara arrived/)
    expect(result.visits).toHaveLength(2)
  })

  it("considers every visit of the day, including one that is not yet due", async () => {
    const result = await getVisitStatus({ clientId: "cli_okoro" }, contextFor())
    expect(result.spoken).toContain("Grace has two visits today")
    expect(result.visits.map((visit) => visit.answer)).toEqual(["arrived", "not_yet_due"])
    expect(result.spoken).toContain("The afternoon visit is scheduled for 2:00 to 4:00 PM ET.")
  })

  it("never answers a confident yes for an unobservable visit that carries an arrival", async () => {
    const context = contextFor()
    const result = await getVisitStatus({ clientId: "cli_nakamura" }, context)
    const unobservable = result.visits.find((visit) => visit.visitId === "v_nakamura_26")
    expect(unobservable?.answer).toBe("unobservable")
    expect(unobservable?.spoken).toContain("could not be fully observed because the doorbell was offline")
    expect(result.visits.find((visit) => visit.visitId === "v_nakamura_27")?.spoken).toContain("22 minutes after the scheduled start")
  })

  it("answers unknown when the only visit could not be observed", async () => {
    const seed = fixtureSeed()
    const repo = createFixtureRepository({ ...seed, visits: seed.visits.filter((visit) => visit.id !== "v_nakamura_27") })
    const result = await getVisitStatus({ clientId: "cli_nakamura" }, contextFor({ repo }))
    expect(result.answer).toBe("unknown")
    expect(result.spoken).toBe(
      "I can't confirm that. The visit could not be fully observed because the doorbell was offline. The door recorded someone arriving at 5:00 AM ET before that.",
    )
  })

  it("answers no for a no-show and not yet for an open window", async () => {
    const result = await getVisitStatus({ clientId: "cli_alvarez" }, contextFor())
    expect(result.answer).toBe("no")
    expect(result.spoken).toContain("No one was seen at the door for the 7:00 AM ET visit")
    expect(result.spoken).toContain("No arrival yet for the 11:30 AM ET visit")
  })

  it("answers not yet before any visit is due", async () => {
    const seed = fixtureSeed()
    const repo = createFixtureRepository({ ...seed, visits: seed.visits.filter((visit) => visit.id !== "v_okoro_26") })
    const result = await getVisitStatus({ clientId: "cli_okoro" }, contextFor({ repo }))
    expect(result.answer).toBe("not_yet")
    expect(result.spoken).toBe("Not yet. The visit is scheduled for 2:00 to 4:00 PM ET.")
  })

  it("reports no visit on an empty day and an unknown client", async () => {
    const empty = await getVisitStatus({ clientId: "cli_okoro", date: "2026-01-01" }, contextFor())
    expect(empty.answer).toBe("unknown")
    expect(empty.spoken).toContain("No visit is scheduled for Grace")
    await expect(getVisitStatus({ clientId: "cli_nobody" }, contextFor())).rejects.toThrow("could not find that client")
  })

  it("lets a family token see only its own client", async () => {
    const context = contextFor({ principal: family("cli_okoro") })
    const own = await getVisitStatus({}, context)
    expect(own.clientId).toBe("cli_okoro")
    await expect(getVisitStatus({ clientId: "cli_nakamura" }, context)).rejects.toThrow("only see its own")
  })
})

describe("list_exceptions", () => {
  it("counts only open exceptions for today's visits, ranked by severity", async () => {
    const result = await listExceptions({}, contextFor())
    expect(result.count).toBe(4)
    expect(result.exceptions.map((item) => item.kind)).toEqual(["no_show", "late_no_arrival", "late_arrival", "unobservable"])
    expect(result.exceptions.some((item) => item.visitId === "v_nakamura_24")).toBe(false)
    expect(result.spoken).toContain("There are 4 open exceptions today")
    expect(result.spoken).toContain("no-show for Rosa at 7:00 AM ET")
  })

  it("widens the window with days and filters by state and kind", async () => {
    expect((await listExceptions({ days: 2 }, contextFor())).count).toBe(5)
    expect((await listExceptions({ state: "resolved" }, contextFor())).count).toBe(1)
    const late = await listExceptions({ kind: "late_arrival", days: 7 }, contextFor())
    expect(late.exceptions.map((item) => item.visitId)).toEqual(["v_nakamura_27"])
    const anyLate = await listExceptions({ kind: "late_arrival", days: 7, state: "any" }, contextFor())
    expect(anyLate.exceptions.map((item) => item.visitId)).toEqual(["v_okoro_24", "v_nakamura_27"])
    expect(anyLate.spoken).toContain("There are 2 late arrival exceptions in the last 7 days")
  })

  it("is agency only", async () => {
    await expect(listExceptions({}, contextFor({ principal: family("cli_okoro") }))).rejects.toThrow("Only the agency")
  })
})

describe("list_visits", () => {
  it("names at most five visits in the spoken answer", async () => {
    const result = await listVisits({}, contextFor())
    expect(result.count).toBe(6)
    expect(result.spoken).toContain("and 1 more")
    expect(result.spoken.match(/ AM ET| PM ET/g)).toHaveLength(5)
  })

  it("scopes a family to its client and filters by status", async () => {
    const result = await listVisits({}, contextFor({ principal: family("cli_okoro") }))
    expect(result.visits.every((visit) => visit.clientId === "cli_okoro")).toBe(true)
    const noShows = await listVisits({ status: "no_show" }, contextFor())
    expect(noShows.visits.map((visit) => visit.visitId)).toEqual(["v_alvarez_26"])
  })
})

describe("explain_visit", () => {
  it("builds the three-column timeline with provenance and signed records", async () => {
    const result = await explainVisit({ visitId: "v_okoro_26" }, contextFor())
    const columns = new Set(result.timeline?.map((entry) => entry.column))
    expect(columns).toEqual(new Set(["observed", "reported"]))
    expect(result.timeline?.some((entry) => entry.provenance === "emulated")).toBe(true)
    expect(result.signedRecords).toHaveLength(2)
    expect(result.spoken).toContain("the door saw someone arrive at 8:04 AM ET")
  })

  it("shows notes and exceptions and refuses unknown visits", async () => {
    const result = await explainVisit({ visitId: "v_nakamura_27" }, contextFor())
    expect(result.timeline?.some((entry) => entry.text.startsWith("Caregiver note"))).toBe(true)
    expect(result.timeline?.some((entry) => entry.column === "resolved")).toBe(true)
    await expect(explainVisit({ visitId: "v_nope" }, contextFor())).rejects.toThrow("could not find that visit")
  })
})

describe("get_client_summary", () => {
  it("counts lateness from the arrival, not the terminal status", async () => {
    const result = await getClientSummary({ clientId: "cli_nakamura" }, contextFor())
    expect(result.counts).toMatchObject({ due: 3, onTime: 1, late: 1, unobservable: 1, noShow: 0 })
    expect(result.lateVisits?.map((visit) => visit.visitId)).toEqual(["v_nakamura_27"])
    expect(result.spoken).toContain("Sunday at 9:00 AM ET, 22 minutes late")
  })
})

describe("acknowledge_exception", () => {
  it("asks for confirmation when the client has no elicitation", async () => {
    const context = contextFor()
    const result = await acknowledgeException({ exceptionId: "v_alvarez_26#no_show", reason: "caregiver_sick" }, context)
    expect(result.status).toBe("confirmation_required")
    expect((await context.repo.getException("v_alvarez_26#no_show"))?.state).toBe("open")
  })

  it("resolves and signs with the confirmed argument", async () => {
    const context = contextFor()
    const result = await acknowledgeException({ exceptionId: "v_alvarez_26#no_show", reason: "caregiver_sick", confirmed: true }, context)
    expect(result).toMatchObject({ status: "done", confirmationMethod: "confirmed_argument", ledgerSeq: 1 })
    expect((await context.repo.getException("v_alvarez_26#no_show"))?.resolution?.reason).toBe("caregiver_sick")
    const ledger = await context.repo.listLedger("cli_alvarez")
    expect(verifyChain(ledger, DEMO_LEDGER_SIGNER.verify)).toBe(true)
  })

  it("uses elicitation when available and honors a decline", async () => {
    const accepted = await acknowledgeException(
      { exceptionId: "v_alvarez_26#no_show", reason: "traffic_delay" },
      contextFor({ elicit: async () => "accepted" }),
    )
    expect(accepted.confirmationMethod).toBe("elicitation")
    const declined = await acknowledgeException({ exceptionId: "v_alvarez_26#no_show", reason: "x1", confirmed: false }, contextFor())
    expect(declined.status).toBe("declined")
  })

  it("is agency only and needs a signer", async () => {
    await expect(
      acknowledgeException({ exceptionId: "v_alvarez_26#no_show", reason: "x1", confirmed: true }, contextFor({ principal: family("cli_alvarez") })),
    ).rejects.toThrow("Only the agency")
    await expect(
      acknowledgeException({ exceptionId: "v_alvarez_26#no_show", reason: "x1", confirmed: true }, contextFor({ signer: undefined })),
    ).rejects.toThrow("Signing is not configured")
  })
})

describe("add_visit_note", () => {
  it("writes a family note and extends the signed chain", async () => {
    const context = contextFor({ principal: family("cli_okoro") })
    const result = await addVisitNote({ visitId: "v_okoro_27", text: "I will be there Thursday instead.", confirmed: true }, context)
    expect(result).toMatchObject({ status: "done", ledgerSeq: 3 })
    const notes = await context.repo.listNotes("v_okoro_27")
    expect(notes[0]).toMatchObject({ authorRole: "family", text: "I will be there Thursday instead." })
    expect(verifyChain(await context.repo.listLedger("cli_okoro"), DEMO_LEDGER_SIGNER.verify)).toBe(true)
  })

  it("refuses a family note on another client's visit", async () => {
    await expect(
      addVisitNote({ visitId: "v_alvarez_26", text: "Hello", confirmed: true }, contextFor({ principal: family("cli_okoro") })),
    ).rejects.toThrow("only see its own")
  })
})
