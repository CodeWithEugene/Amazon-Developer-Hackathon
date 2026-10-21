import { describe, expect, it } from "vitest"

import { buildEvidencePack, canonicalHash, canonicalJson } from "./evidence"
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

describe("buildEvidencePack timeline", () => {
  it("covers an empty range and lays out observed, reported, and resolved entries", () => {
    const empty = buildEvidencePack({
      client,
      visits: [],
      events: [],
      evvRecords: [],
      exceptions: [],
      tolerances: DEFAULT_TOLERANCES,
      now,
    })
    expect(empty.rangeStart).toBe(now.toISOString())
    expect(empty.rangeEnd).toBe(now.toISOString())

    const pack = buildEvidencePack({
      client,
      visits: [visit({ status: "no_show", reconciliation: { outcome: "missing_both" } })],
      events: [
        {
          ...audit,
          clientId: "c1",
          requestId: "r1",
          timestampMs: Date.parse("2026-10-01T06:01:00.000Z"),
          at: "2026-10-01T06:01:00.000Z",
          type: "motion",
          subType: "human",
          provenance: "emulated",
          rawPayloadHash: "h",
          componentIds: [],
        },
      ],
      evvRecords: [{ ...evv, clockOut: undefined }],
      exceptions: [
        {
          ...audit,
          id: "v1#no_show",
          agencyId: "a1",
          visitId: "v1",
          clientId: "c1",
          kind: "no_show",
          state: "resolved",
          openedAt: "2026-10-01T06:45:00.000Z",
          resolution: { by: "dana", at: "2026-10-01T07:00:00.000Z", reason: "Replacement sent" },
        },
      ],
      tolerances: DEFAULT_TOLERANCES,
      now,
    })
    expect(pack.visits[0]?.exceptionKinds).toEqual(["no_show"])
    expect(pack.visits[0]?.reconciliation?.outcome).toBe("missing_both")
    expect(pack.timeline.map((entry) => entry.column)).toEqual(["observed", "reported", "resolved", "resolved"])
    expect(pack.timeline[0]?.label).toBe("motion (human) via emulated")
  })
})
