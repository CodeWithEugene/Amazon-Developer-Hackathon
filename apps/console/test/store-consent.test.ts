import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  addNote,
  buildEvidencePackPdf,
  ConsentError,
  deleteClientData,
  listLedgerRecords,
  listNotes,
  toOpenEvvExport,
  updateConsent,
  verifyLedgerRecords,
} from "@/lib/store"
import { loadCompliance } from "@/lib/views/compliance"
import { loadTodayBoard } from "@/lib/views/today"

import {
  createTestStore,
  exception,
  seedTwoWeeks,
  type Seeded,
  type TestStore,
} from "./fixtures"

let store: TestStore
let seeded: Seeded
const now = new Date()

beforeEach(async () => {
  store = await createTestStore()
  seeded = await seedTwoWeeks(store.repo, now)
  await store.repo.exceptions.put(exception(seeded.visits[12]!, "no_show"))
})
afterEach(async () => store.cleanup())

describe("consent enforcement (contract C3)", () => {
  it("hides a client from agency views and exports once sharing is withdrawn", async () => {
    expect((await toOpenEvvExport()).includes("v_okoro_00")).toBe(true)

    await updateConsent("cli_okoro", { shareWithAgency: false })

    expect((await toOpenEvvExport()).includes("v_okoro_")).toBe(false)
    await expect(buildEvidencePackPdf("cli_okoro")).rejects.toBeInstanceOf(ConsentError)
    const compliance = await loadCompliance(now)
    expect(compliance.rows.some((r) => r.clientId === "cli_okoro")).toBe(false)
    expect(compliance.chains.find((c) => c.clientId === "cli_okoro")?.records).toEqual([])
    const board = await loadTodayBoard(now)
    expect(board.exceptions).toHaveLength(0)
    const todays = board.visits.filter((v) => v.clientName === "Grace Okoro")
    expect(todays.every((v) => v.hidden && v.arrival === "hidden")).toBe(true)
  })

  it("Delete Everything removes the link, door events, and notes, and signs the deletion", async () => {
    const target = seeded.visits[1]!
    await addNote({ visitId: target.id, authorRole: "family", authorId: "f", text: "Thank you" })

    const summary = await deleteClientData("cli_okoro")

    const client = await store.repo.clients.get("a1", "cli_okoro")
    expect(client?.ringLinkStatus).toBe("removed")
    expect(client?.consent.shareWithAgency).toBe(false)
    if (summary.physicalDeletion) {
      expect(await store.repo.events.byClient("cli_okoro")).toHaveLength(0)
      expect(await listNotes(target.id)).toHaveLength(0)
      expect(summary.events).toBe(28)
    }
    const ledger = await listLedgerRecords("cli_okoro")
    const last = ledger.at(-1)
    expect(last?.subject).toBe("data-deletion")
    expect(last?.column).toBe("resolved")
    expect(verifyLedgerRecords(ledger)).toBe(true)
  })
})
