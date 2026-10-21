import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository } from "@visitproof/db"
import { verifyChain, type LedgerRecord, type Visit } from "@visitproof/domain"
import { describe, expect, it } from "vitest"

import {
  createLocalHmacLedgerSigner,
  createVisitSweeper,
  ingestDoorEvent,
  repositoryLedger,
  type EngineDeps,
  type LedgerEntry,
} from "../src"
import { doorEvent, testAgency, testDeps, testVisit } from "./helpers"

const memoryLedger = () => {
  const entries: LedgerEntry[] = []
  return {
    entries,
    append: async (entry: LedgerEntry) => void entries.push(entry),
  }
}

/** Class-backed stores lose their methods under spread, so wrap them. */
const visitsOf = (
  deps: EngineDeps,
  overrides: Partial<EngineDeps["visits"]> = {}
): EngineDeps["visits"] => ({
  listForClient: (clientId) => deps.visits.listForClient(clientId),
  listActive: () => deps.visits.listActive(),
  listAll: () => deps.visits.listAll(),
  save: (visit) => deps.visits.save(visit),
  ...overrides,
})

const withClock = (deps: EngineDeps, at: string): EngineDeps => ({
  ...deps,
  clock: { now: () => new Date(at) },
})

describe("engine ledger appends (EARS rule 10)", () => {
  it("ledgers the door event and the visit observation as the event is ingested", async () => {
    const ledger = memoryLedger()
    const deps = {
      ...testDeps("2026-10-01T11:58:10.000Z", { agency: testAgency() }),
      ledger,
    }
    const ding = doorEvent("2026-10-01T11:58:00.000Z", "ding")
    await ingestDoorEvent(deps, ding)
    expect(
      ledger.entries.map((entry) => [entry.column, entry.subject])
    ).toEqual([
      ["observed", ding.requestId],
      ["observed", "v1"],
    ])
    expect(ledger.entries[1]?.payload).toMatchObject({
      kind: "visit_observation",
      status: "arrived_on_time",
    })
    expect(ledger.entries[0]?.at.toISOString()).toBe("2026-10-01T11:58:10.000Z")
  })

  it("records the domain's resolution reason and ledgers it as resolved", async () => {
    const ledger = memoryLedger()
    const base = {
      ...testDeps("2026-10-01T12:20:00.000Z", { agency: testAgency() }),
      ledger,
    }
    await createVisitSweeper(base)({} as never)
    expect((await base.exceptions.listOpen()).map((e) => e.kind)).toEqual([
      "late_no_arrival",
    ])

    const late = withClock(base, "2026-10-01T12:25:10.000Z")
    await ingestDoorEvent(late, doorEvent("2026-10-01T12:25:00.000Z", "ding"))
    const resolved = (await base.exceptions.listForClient("c1")).find(
      (e) => e.kind === "late_no_arrival"
    )
    expect(resolved?.resolution?.reason).toBe("Arrival observed")
    expect(
      ledger.entries
        .filter((entry) => entry.column === "resolved")
        .map((entry) => entry.subject)
    ).toEqual(["v1#late_no_arrival"])
    expect(
      ledger.entries.some((entry) => entry.subject === "v1#late_arrival")
    ).toBe(true)
  })

  it("does not re-save or re-ledger a visit the sweep leaves unchanged", async () => {
    const ledger = memoryLedger()
    const saved: string[] = []
    const base = testDeps("2026-10-01T09:00:00.000Z", {
      visits: [testVisit({ status: "scheduled" })],
    })
    const deps: EngineDeps = {
      ...base,
      ledger,
      visits: visitsOf(base, {
        save: async (visit: Visit) => void saved.push(visit.id),
      }),
    }
    await createVisitSweeper(deps)({} as never)
    await createVisitSweeper(deps)({} as never)
    expect(saved).toEqual([])
    expect(ledger.entries).toEqual([])
  })

  it("applies the device check: an encrypted front door makes the visit unobservable", async () => {
    const deps: EngineDeps = {
      ...testDeps("2026-10-01T11:58:10.000Z"),
      devices: { forClient: async () => ({ encryptionState: "take" }) },
    }
    await ingestDoorEvent(deps, doorEvent("2026-10-01T11:58:00.000Z", "ding"))
    const [visit] = await deps.visits.listForClient("c1")
    expect(visit?.observability).toEqual({
      state: "unobservable",
      reasons: ["encrypted_device"],
    })
  })

  it("passes settled visits as context so an overlapping window keeps its events", async () => {
    const settled = testVisit({
      id: "v0",
      scheduledStart: "2026-10-01T09:00:00.000Z",
      scheduledEnd: "2026-10-01T11:00:00.000Z",
      status: "completed",
      arrival: { at: "2026-10-01T09:01:00.000Z", source: "rule" },
      departure: { at: "2026-10-01T11:02:00.000Z", source: "rule" },
    })
    const listed: string[][] = []
    const base = testDeps("2026-10-01T12:05:00.000Z", {
      visits: [settled, testVisit()],
    })
    const deps: EngineDeps = {
      ...base,
      visits: visitsOf(base, {
        listActive: async () => {
          const active = (await base.visits.listAll()).filter(
            (visit) => visit.status !== "completed"
          )
          listed.push(active.map((visit) => visit.id))
          return active
        },
      }),
    }
    await createVisitSweeper(deps)({} as never)
    expect(listed).toEqual([["v1"]])
    const [v0] = (await deps.visits.listForClient("c1")).filter(
      (visit) => visit.id === "v0"
    )
    expect(v0?.status).toBe("completed")
  })
})

describe("repositoryLedger", () => {
  it("appends a verifiable per-client hash chain", async () => {
    const repository = createLocalRepository(
      await mkdtemp(join(tmpdir(), "engine-ledger-"))
    )
    const signer = createLocalHmacLedgerSigner({ secret: "test-secret" })
    const ledger = repositoryLedger(repository, signer)
    const at = new Date("2026-10-01T12:00:00.000Z")
    await ledger.append({
      clientId: "c1",
      column: "observed",
      subject: "e1",
      payload: { a: 1 },
      at,
    })
    await ledger.append({
      clientId: "c1",
      column: "resolved",
      subject: "x1",
      payload: { b: 2 },
      at,
    })
    await ledger.append({
      clientId: "c2",
      column: "observed",
      subject: "e2",
      payload: {},
      at,
    })
    const chain: LedgerRecord[] = await repository.evidence.ledgerByClient("c1")
    expect(chain.map((record) => record.seq)).toEqual([1, 2])
    const verdicts = await Promise.all(
      chain.map((record) => signer.verify(record))
    )
    expect(verdicts).toEqual([true, true])
    expect(verifyChain(chain, () => true)).toBe(true)
    expect(
      (await repository.evidence.ledgerByClient("c2")).map(
        (record) => record.seq
      )
    ).toEqual([1])
  })
})
