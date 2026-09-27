import { describe, expect, it } from "vitest"

import {
  buildEvidencePack,
  canonicalHash,
  canonicalJson,
  ledgerSigningHash,
  signLedger,
  toOpenEvvVisit,
  verifyChain,
} from "./evidence"
import { DEFAULT_TOLERANCES, type Client, type EVVRecord, type Visit } from "./types"

const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
}
const now = new Date("2026-10-01T09:00:00.000Z")

const client: Client = {
  ...audit,
  id: "c1",
  agencyId: "a1",
  name: "Okoro Residence",
  homeLabel: "Home",
  familyContacts: [],
  ringLinkStatus: "linked",
  consent: { shareWithAgency: true, snapshotsEnabled: false, snapshotRetentionDays: 7, digestHour: 19, exceptionAlerts: true },
  serviceCodes: ["T1019"],
}

function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    ...audit,
    id: "v1",
    clientId: "c1",
    agencyId: "a1",
    caregiverId: "cg1",
    serviceCode: "T1019",
    date: "2026-10-01",
    scheduledStart: "2026-10-01T06:00:00.000Z",
    scheduledEnd: "2026-10-01T08:00:00.000Z",
    status: "completed",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

const evv: EVVRecord = {
  ...audit,
  id: "e1",
  clientId: "c1",
  agencyId: "a1",
  caregiverEvvId: "cg-1",
  serviceCode: "T1019",
  clockIn: "2026-10-01T06:05:00.000Z",
  clockOut: "2026-10-01T08:10:00.000Z",
  source: "csv",
}

describe("canonicalJson", () => {
  it("is order-independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 })
    )
    expect(canonicalHash({ a: 1 })).toBe(canonicalHash({ a: 1 }))
  })
})

describe("buildEvidencePack", () => {
  it("summarizes visits with reconciliation and a deterministic hash", () => {
    const pack = buildEvidencePack({
      client,
      visits: [
        visit({
          arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
          departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
        }),
      ],
      events: [],
      evvRecords: [evv],
      exceptions: [],
      tolerances: DEFAULT_TOLERANCES,
      now,
    })
    expect(pack.clientName).toBe("Okoro Residence")
    expect(pack.visits[0]?.reconciliation?.outcome).toBe("corroborated")
    expect(pack.timeline.some((entry) => entry.column === "reported")).toBe(true)
    expect(pack.payloadHash).toBe(
      buildEvidencePack({
        client,
        visits: [
          visit({
            arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
            departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
          }),
        ],
        events: [],
        evvRecords: [evv],
        exceptions: [],
        tolerances: DEFAULT_TOLERANCES,
        now,
      }).payloadHash
    )
  })
})

describe("toOpenEvvVisit", () => {
  it("prefers door-observed times and flags missing clock-ins", () => {
    const json = toOpenEvvVisit(
      visit({
        arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
        departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
      })
    )
    expect(json.StartDateTime).toBe("2026-10-01T06:02:00.000Z")
    expect(json.EndDateTime).toBe("2026-10-01T08:05:00.000Z")
    expect(json.ExceptionIndicator).toBe("MISSING_CLOCK_IN")

    expect(toOpenEvvVisit(visit(), evv).StartDateTime).toBe(evv.clockIn)
    expect(toOpenEvvVisit(visit(), evv).ExceptionIndicator).toBeUndefined()
  })
})

describe("signLedger", () => {
  it("chains records and verifies", () => {
    const first = signLedger({
      clientId: "c1",
      seq: 0,
      column: "observed",
      subject: "v1",
      payload: { at: "2026-10-01T06:02:00.000Z" },
      signerKeyId: "key-1",
      at: "2026-10-01T06:02:01.000Z",
      sign: (hash) => `sig(${hash.slice(0, 8)})`,
    })
    const second = signLedger({
      clientId: "c1",
      seq: 1,
      column: "reported",
      subject: "v1",
      payload: { clockIn: "2026-10-01T06:05:00.000Z" },
      signerKeyId: "key-1",
      at: "2026-10-01T06:05:01.000Z",
      prev: first,
      sign: (hash) => `sig(${hash.slice(0, 8)})`,
    })
    expect(second.prevHash).toBe(canonicalHash(first))
    expect(verifyChain([second, first], (record) => record.signature.startsWith("sig("))).toBe(true)
    const broken = { ...second, prevHash: "deadbeef" }
    expect(verifyChain([first, broken], () => true)).toBe(false)
  })

  it("signs the record context, not just the payload hash", () => {
    const signed: string[] = []
    const sign = (hash: string): string => {
      signed.push(hash)
      return `sig(${hash.slice(0, 8)})`
    }
    const base = {
      clientId: "c1",
      column: "observed" as const,
      subject: "v1",
      payload: { at: "2026-10-01T06:02:00.000Z" },
      signerKeyId: "key-1",
      sign,
    }
    const first = signLedger({ ...base, seq: 0, at: "2026-10-01T06:02:01.000Z" })
    const samePayloadNextSeq = signLedger({
      ...base,
      seq: 1,
      at: "2026-10-01T06:02:02.000Z",
      prev: first,
    })
    // Identical payload hash, but the signatures bind seq and prevHash, so
    // they differ and cannot be transplanted between records.
    expect(samePayloadNextSeq.payloadHash).toBe(first.payloadHash)
    expect(samePayloadNextSeq.signature).not.toBe(first.signature)
    expect(signed[0]).toBe(ledgerSigningHash(first))
    expect(signed[1]).toBe(ledgerSigningHash(samePayloadNextSeq))
    // A verifier recomputes the context hash from the stored record alone.
    expect(
      verifyChain([samePayloadNextSeq, first], (record) => {
        const expected = `sig(${ledgerSigningHash(record).slice(0, 8)})`
        return record.signature === expected
      }),
    ).toBe(true)
  })
})
