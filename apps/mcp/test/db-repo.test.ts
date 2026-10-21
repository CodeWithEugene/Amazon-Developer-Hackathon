import { afterEach, describe, expect, it } from "vitest"
import { verifyChain } from "@visitproof/domain"

import { DEMO_NOW } from "../src/repo"
import { DEMO_LEDGER_SIGNER } from "../src/signer"
import {
  acknowledgeException,
  addVisitNote,
  getClientSummary,
  getVisitStatus,
  listExceptions,
  listVisits,
  type ToolContext,
} from "../src/tools"
import { seedLocalStore, type SeededStore } from "./helpers/seed"

let seeded: SeededStore | undefined

afterEach(async () => {
  await seeded?.cleanup()
  seeded = undefined
})

const contextFor = (store: SeededStore, overrides: Partial<ToolContext> = {}): ToolContext => ({
  repo: store.repo,
  now: () => DEMO_NOW,
  signer: DEMO_LEDGER_SIGNER,
  ...overrides,
})

describe("createDbVisitRepository over a temp-directory local store", () => {
  it("selects visits by the agency-local date, not the UTC date", async () => {
    seeded = await seedLocalStore((seed) => ({
      ...seed,
      // 9:30 PM ET on the 27th is already the 28th in UTC.
      visits: [
        ...seed.visits,
        { ...seed.visits[2]!, id: "v_okoro_28", scheduledStart: "2026-09-28T01:30:00.000Z", scheduledEnd: "2026-09-28T02:30:00.000Z", status: "scheduled", arrival: undefined, departure: undefined, reconciliation: undefined },
      ],
    }))
    const today = await seeded.repo.listVisitsByDate("2026-09-27", "cli_okoro")
    expect(today.map((visit) => visit.id)).toEqual(["v_okoro_26", "v_okoro_27", "v_okoro_28"])
    expect((await seeded.repo.listVisitsByDate("2026-09-28", "cli_okoro")).map((visit) => visit.id)).toEqual([])
  })

  it("filters exceptions by the visit's date, not openedAt", async () => {
    seeded = await seedLocalStore()
    const today = await seeded.repo.listExceptions("2026-09-27", "open")
    expect(today.map((exception) => exception.id).sort()).toEqual([
      "v_alvarez_26#no_show",
      "v_alvarez_27#late_no_arrival",
      "v_nakamura_26#unobservable",
      "v_nakamura_27#late_arrival",
    ])
  })

  it("runs every read tool against the seeded store", async () => {
    seeded = await seedLocalStore()
    const context = contextFor(seeded)
    const nakamura = await getVisitStatus({ clientId: "cli_nakamura" }, context)
    expect(nakamura.visits.map((visit) => visit.answer)).toEqual(["unobservable", "arrived"])
    expect(nakamura.spoken).toContain("Priya Sharma clocked in at 9:25 AM ET")
    expect((await listExceptions({}, context)).count).toBe(4)
    expect((await listVisits({}, context)).count).toBe(6)
    expect((await getClientSummary({ clientId: "cli_nakamura" }, context)).counts?.late).toBe(1)
  })

  it("persists confirmed writes to disk with a verifiable ledger chain", async () => {
    seeded = await seedLocalStore()
    const context = contextFor(seeded)
    await acknowledgeException({ exceptionId: "v_nakamura_27#late_arrival", reason: "road_work", confirmed: true }, context)
    await addVisitNote({ visitId: "v_okoro_26", text: "Thank you for today.", confirmed: true }, contextFor(seeded, { principal: { kind: "family", subject: "demo:family", clientId: "cli_okoro" } }))
    const fresh = seeded.store()
    expect((await fresh.exceptions.get("a1", "v_nakamura_27#late_arrival"))?.state).toBe("resolved")
    expect((await fresh.evidence.notesByVisit("v_okoro_26")).map((note) => note.authorRole)).toEqual(["family"])
    for (const clientId of ["cli_nakamura", "cli_okoro"]) {
      expect(verifyChain(await fresh.evidence.ledgerByClient(clientId), DEMO_LEDGER_SIGNER.verify)).toBe(true)
    }
  })

  it("hides visit details from the agency when the family turned off sharing", async () => {
    seeded = await seedLocalStore((seed) => ({
      ...seed,
      clients: seed.clients.map((client) =>
        client.id === "cli_alvarez" ? { ...client, consent: { ...client.consent, shareWithAgency: false } } : client,
      ),
    }))
    const agency = await getVisitStatus({ clientId: "cli_alvarez" }, contextFor(seeded))
    expect(agency.detailsHidden).toBe(true)
    expect(agency.visits).toEqual([])
    const listed = await listVisits({}, contextFor(seeded))
    expect(listed.visits.filter((visit) => visit.clientId === "cli_alvarez").every((visit) => visit.detailsHidden && !visit.status)).toBe(true)
    const family = await getVisitStatus({}, contextFor(seeded, { principal: { kind: "family", subject: "demo:f", clientId: "cli_alvarez" } }))
    expect(family.visits).toHaveLength(2)
  })

  it("hides visit details from the agency once the family removed the Ring link", async () => {
    seeded = await seedLocalStore((seed) => ({
      ...seed,
      clients: seed.clients.map((client) =>
        client.id === "cli_alvarez" ? { ...client, ringLinkStatus: "removed" as const } : client,
      ),
    }))
    const agency = await getVisitStatus({ clientId: "cli_alvarez" }, contextFor(seeded))
    expect(agency.detailsHidden).toBe(true)
    expect(agency.visits).toEqual([])
  })
})
