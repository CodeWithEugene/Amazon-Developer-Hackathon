import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  ConflictError,
  getVisit,
  listLedgerRecords,
  listNotes,
  recordAgencyCorrection,
  resolveException,
  snoozeException,
  verifyLedgerRecords,
} from "@/lib/store"

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
})
afterEach(async () => store.cleanup())

describe("agency correction (Backfill Times, contract C2)", () => {
  it("never overwrites the door-observed times and records a signed agency correction", async () => {
    const target = seeded.visits[3]!
    const late = exception(target, "late_arrival")
    await store.repo.exceptions.put(late)

    const result = await recordAgencyCorrection(
      target.id,
      { arrivalLocal: "09:20", departureLocal: "11:05", reason: "traffic", exceptionId: late.id },
      "scheduler"
    )

    const after = await getVisit(target.id)
    expect(after?.arrival).toEqual(target.arrival)
    expect(after?.departure).toEqual(target.departure)
    expect(after?.reconciliation).toEqual(target.reconciliation)
    expect(after?.status).toBe(target.status)

    const notes = await listNotes(target.id)
    expect(notes).toHaveLength(1)
    expect(notes[0]?.authorRole).toBe("agency_staff")
    expect(notes[0]?.text).toContain("arrival 9:20 AM ET")

    const ledger = await listLedgerRecords(target.clientId)
    expect(ledger.at(-1)?.column).toBe("resolved")
    expect(ledger.at(-1)?.subject).toBe(target.id)
    expect(verifyLedgerRecords(ledger)).toBe(true)

    expect(result.resolvedExceptions.map((e) => e.state)).toEqual(["resolved"])
    const stored = await store.repo.exceptions.get("a1", late.id)
    expect(stored?.resolution?.reason).toBe("traffic")
  })

  it("rejects a correction whose departure is before its arrival", async () => {
    const target = seeded.visits[2]!
    await expect(
      recordAgencyCorrection(target.id, { arrivalLocal: "11:00", departureLocal: "10:00" }, "scheduler")
    ).rejects.toThrow("The departure must be after the arrival.")
    expect(await listLedgerRecords(target.clientId)).toHaveLength(0)
  })

  it("leaves review kinds such as contradicted open", async () => {
    const target = seeded.visits[4]!
    await store.repo.exceptions.put(exception(target, "no_show"))
    await store.repo.exceptions.put(exception(target, "contradicted"))
    const result = await recordAgencyCorrection(target.id, { arrivalLocal: "09:10" }, "scheduler")
    expect(result.resolvedExceptions.map((e) => e.kind)).toEqual(["no_show"])
    const review = await store.repo.exceptions.get("a1", `${target.id}#contradicted`)
    expect(review?.state).toBe("open")
  })
})

describe("exception transitions", () => {
  it("ledgers a snooze and refuses to reopen a resolved card", async () => {
    const target = seeded.visits[5]!
    const open = exception(target, "late_no_arrival")
    await store.repo.exceptions.put(open)

    const snoozedCard = await snoozeException(open.id, 10, "scheduler")
    expect(snoozedCard.state).toBe("snoozed")
    expect((await listLedgerRecords(target.clientId)).at(-1)?.subject).toBe(open.id)

    await resolveException(open.id, { by: "scheduler", reason: "traffic" })
    await expect(snoozeException(open.id, 10)).rejects.toBeInstanceOf(ConflictError)
    await expect(
      resolveException(open.id, { by: "compliance", reason: "second" })
    ).rejects.toBeInstanceOf(ConflictError)

    const stored = await store.repo.exceptions.get("a1", open.id)
    expect(stored?.resolution?.by).toBe("scheduler")
    const ledger = await listLedgerRecords(target.clientId)
    expect(ledger).toHaveLength(2)
    expect(verifyLedgerRecords(ledger)).toBe(true)
  })
})
