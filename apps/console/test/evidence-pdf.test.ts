import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildEvidencePackPdf, listLedgerRecords, resolveException } from "@/lib/store"
import { toPdfText, wrapText } from "@/lib/pdf/writer"
import { formatLocalDate } from "@/lib/time"

import { createTestStore, exception, seedTwoWeeks, TZ, type Seeded, type TestStore } from "./fixtures"

let store: TestStore
let seeded: Seeded

beforeEach(async () => {
  store = await createTestStore()
  seeded = await seedTwoWeeks(store.repo, new Date())
  const late = exception(seeded.visits[6]!, "late_arrival")
  await store.repo.exceptions.put(late)
  await resolveException(late.id, { by: "scheduler", reason: "traffic" })
})
afterEach(async () => store.cleanup())

/** PDF bytes as text with string escapes removed, for content checks. */
const text = (pdf: Uint8Array): string =>
  new TextDecoder("latin1").decode(pdf).replace(/\\([()\\])/g, "$1")

describe("Evidence Pack PDF", () => {
  it("contains every visit of a two-week client, the ledger, and the pack hash", async () => {
    const pdf = text(await buildEvidencePackPdf("cli_okoro"))

    expect(pdf.startsWith("%PDF-1.4")).toBe(true)
    for (const visit of seeded.visits) {
      expect(pdf).toContain(`Visit ${visit.id}.`)
      expect(pdf).toContain(formatLocalDate(visit.scheduledStart, TZ))
    }
    const hash = /Pack hash: ([0-9a-f]{64})/.exec(pdf)?.[1]
    expect(hash).toBeDefined()
    expect(pdf).toContain(`(${hash}) Tj`)
    expect(pdf).toContain("local-demo/ledger-signing-key")

    const ledger = await listLedgerRecords("cli_okoro")
    expect(ledger.length).toBeGreaterThan(0)
    for (const record of ledger) {
      expect(pdf).toContain(`signature ${record.signature}`)
    }
    const pages = pdf.match(/\/Type \/Page /g) ?? []
    expect(pages.length).toBeGreaterThan(1)
    expect(pdf).toContain(`Page ${pages.length} of ${pages.length}`)
  })

  it("uses human labels and agency-local times, never enum strings", async () => {
    const pdf = text(await buildEvidencePackPdf("cli_okoro"))
    expect(pdf).toContain("Status: Completed")
    expect(pdf).toContain("Late Arrival resolved by scheduler: Traffic Or Transit Delay")
    expect(pdf).toContain("9:00 AM ET")
    expect(pdf).toContain("Emulated Event (Demo)")
    expect(pdf).not.toMatch(/Status: (completed|arrived_on_time)/)
    expect(pdf).not.toContain(" UTC")
  })
})

describe("PDF text helpers", () => {
  it("wraps long lines and hard-splits unbroken hashes", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"])
    expect(wrapText("a".repeat(20), 8)).toEqual(["aaaaaaaa", "aaaaaaaa", "aaaa"])
  })

  it("replaces characters outside printable ASCII", () => {
    expect(toPdfText("It’s 9:00 AM")).toBe("It's 9:00 AM")
  })
})
