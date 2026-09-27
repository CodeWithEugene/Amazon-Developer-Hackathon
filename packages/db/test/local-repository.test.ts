import { mkdtemp, readFile, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { VisitProofRepository } from "../src"
import { createLocalRepository } from "../src"
import {
  makeCaregiver,
  makeClient,
  makeDoorEvent,
  makeEvvRecord,
  makeException,
  makeLedgerRecord,
  makeNote,
  makeSnapshot,
  makeVisit,
} from "./fixtures"

let dir: string
let repo: VisitProofRepository

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "visitproof-db-"))
  repo = createLocalRepository(dir)
})

afterAll(async () => {
  await readdir(dir) // keep the temp dir; the OS prunes tmpdir
})

describe("local repository round-trip", () => {
  it("round-trips clients and consent updates", async () => {
    const client = makeClient()
    await repo.clients.put(client)
    expect(await repo.clients.get("agency-1", "client-1")).toEqual(client)
    expect(await repo.clients.byAgency("agency-1")).toEqual([client])

    const updated = await repo.clients.saveConsent(
      "agency-1",
      "client-1",
      { ...client.consent, snapshotsEnabled: true, consentedAt: "2026-10-01T10:00:00.000Z" },
      new Date("2026-10-01T10:00:00.000Z")
    )
    expect(updated.consent.snapshotsEnabled).toBe(true)
    expect(updated.version).toBe(2)
  })

  it("round-trips visits by client, agency, and date", async () => {
    const early = makeVisit({
      id: "visit-early",
      scheduledStart: "2026-10-01T12:00:00.000Z",
      scheduledEnd: "2026-10-01T14:00:00.000Z",
    })
    await repo.visits.put(makeVisit())
    await repo.visits.put(early)
    await repo.visits.put(
      makeVisit({ id: "visit-2", clientId: "client-2", agencyId: "agency-1" })
    )

    expect((await repo.visits.byClient("client-1")).map((v) => v.id)).toEqual([
      "visit-1",
      "visit-early",
    ])
    const today = await repo.visits.byAgencyAndDate("agency-1", "2026-10-01")
    expect(today.map((v) => v.id)).toEqual(["visit-early", "visit-1", "visit-2"])
    expect(await repo.visits.byAgencyAndDate("agency-1", "2026-10-02")).toEqual([])
    expect(await repo.visits.get("client-1", "visit-1")).toBeTruthy()
    expect(await repo.visits.get("client-1", "nope")).toBeNull()
  })

  it("round-trips door events with since and limit", async () => {
    await repo.events.put(makeDoorEvent({ requestId: "r1", timestampMs: 100 }))
    await repo.events.put(makeDoorEvent({ requestId: "r2", timestampMs: 200 }))
    await repo.events.put(
      makeDoorEvent({ requestId: "r3", timestampMs: 300, clientId: "client-2" })
    )

    const all = await repo.events.byClient("client-1")
    expect(all.map((e) => e.requestId)).toEqual(["r1", "r2"])
    const since = await repo.events.byClient("client-1", { sinceMs: 150 })
    expect(since.map((e) => e.requestId)).toEqual(["r2"])
    expect(await repo.events.byClient("client-1", { limit: 1 })).toHaveLength(1)
  })

  it("round-trips exception cards by agency and state", async () => {
    await repo.exceptions.put(makeException())
    await repo.exceptions.put(
      makeException({
        id: "exc-2",
        state: "resolved",
        openedAt: "2026-10-01T15:00:00.000Z",
      })
    )
    const open = await repo.exceptions.byAgency("agency-1", "open")
    expect(open.map((e) => e.id)).toEqual(["exc-1"])
    const all = await repo.exceptions.byAgency("agency-1")
    expect(all.map((e) => e.id)).toEqual(["exc-2", "exc-1"]) // newest first
    expect(await repo.exceptions.get("agency-1", "exc-1")).toBeTruthy()
  })

  it("round-trips caregivers", async () => {
    await repo.caregivers.put(makeCaregiver())
    expect((await repo.caregivers.byAgency("agency-1")).map((c) => c.id)).toEqual([
      "cg-1",
    ])
    expect(await repo.caregivers.get("agency-1", "cg-1")).toBeTruthy()
    expect(await repo.caregivers.get("agency-1", "nope")).toBeNull()
  })

  it("round-trips EVV clock-in records", async () => {
    await repo.evvRecords.put(makeEvvRecord())
    const records = await repo.evvRecords.byClient("client-1")
    expect(records).toHaveLength(1)
    expect(records[0]?.clockIn).toBe("2026-10-01T14:03:00.000Z")
    expect(await repo.evvRecords.get("client-1", "evv-1")).toBeTruthy()
  })

  it("round-trips evidence: notes, snapshots, and the append-only ledger", async () => {
    await repo.evidence.putNote(makeNote())
    await repo.evidence.putSnapshot(makeSnapshot())
    await repo.evidence.appendLedger(makeLedgerRecord(0))
    await repo.evidence.appendLedger(makeLedgerRecord(1))

    expect((await repo.evidence.notesByVisit("visit-1")).map((n) => n.id)).toEqual([
      "note-1",
    ])
    expect(
      (await repo.evidence.snapshotsByVisit("visit-1")).map((s) => s.s3Key)
    ).toEqual(["snapshots/visit-1/1.jpg"])
    expect((await repo.evidence.ledgerByClient("client-1")).map((r) => r.seq)).toEqual([
      0, 1,
    ])
    await expect(
      repo.evidence.appendLedger(makeLedgerRecord(1))
    ).rejects.toThrow(/already exists/)
  })

  it("links and unlinks Ring accounts to clients", async () => {
    await repo.ringLinks.link("client-1", "acct-1", new Date())
    expect(await repo.ringLinks.clientIdFor("acct-1")).toBe("client-1")
    expect(await repo.ringLinks.clientIdFor("unknown")).toBeNull()
    await repo.ringLinks.unlink("acct-1")
    expect(await repo.ringLinks.clientIdFor("acct-1")).toBeNull()
  })

  it("claims webhook receipts exactly once (replay protection)", async () => {
    const now = new Date("2026-10-01T14:00:00.000Z")
    expect(await repo.webhookReceipts.claim("req-abc", now)).toBe(true)
    expect(await repo.webhookReceipts.claim("req-abc", now)).toBe(false)
    expect(await repo.webhookReceipts.claim("req-other", now)).toBe(true)
  })

  it("persists one JSON file per table on disk", async () => {
    const files = new Set(await readdir(dir))
    for (const expected of [
      "visits.json",
      "events.json",
      "exceptions.json",
      "caregivers.json",
      "clients.json",
      "evv-records.json",
      "notes.json",
      "snapshots.json",
      "ledger.json",
      "webhook-receipts.json",
    ]) {
      expect(files.has(expected), expected).toBe(true)
    }
    const events = JSON.parse(await readFile(join(dir, "events.json"), "utf8"))
    expect(Array.isArray(events)).toBe(true)
    expect(events.length).toBe(3)
  })

  it("survives a fresh repository instance over the same directory", async () => {
    const reopened = createLocalRepository(dir)
    expect(await reopened.clients.get("agency-1", "client-1")).toBeTruthy()
    expect(await reopened.webhookReceipts.claim("req-abc", new Date())).toBe(false)
    const visit = await reopened.visits.get("client-1", "visit-1")
    expect(visit?.id).toBe("visit-1")
  })
})
