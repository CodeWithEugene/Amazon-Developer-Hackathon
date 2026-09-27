import { describe, expect, it } from "vitest"

import {
  doorEventSchema,
  type Client,
  type DoorEvent,
  type Visit,
} from "@visitproof/domain"

import {
  InMemoryEvidenceStore,
  InMemoryNarrativeStore,
  inMemoryEngineDeps,
} from "../lib/defaults"
import { createEventProcessor } from "./event-processor"
import { createExporter } from "./exporter"
import { createMailer } from "./mailer"
import { createNarrativeWriter } from "./narrative-writer"
import { createSnapshotFetcher } from "./snapshot-fetcher"
import { createVisitSweeper } from "./visit-sweeper"

const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
}

let seq = 0
function doorEvent(at: string, type: DoorEvent["type"], subType?: string): DoorEvent {
  seq += 1
  return doorEventSchema.parse({
    ...audit,
    clientId: "c1",
    requestId: `req-${seq}`,
    timestampMs: Date.parse(at),
    at,
    type,
    subType,
    provenance: "emulated",
    rawPayloadHash: `h${seq}`,
  })
}

function testVisit(overrides: Partial<Visit> = {}): Visit {
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
    status: "awaiting_arrival",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

const client: Client = {
  ...audit,
  id: "c1",
  agencyId: "a1",
  name: "Okoro Residence",
  homeLabel: "Home",
  familyContacts: [{ name: "Priya Okoro", email: "priya@example.com", relationship: "daughter" }],
  ringLinkStatus: "linked",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: true,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["T1019"],
}

function fixedClock(at: string) {
  let current = new Date(at)
  return {
    now: () => current,
    advanceTo: (next: string) => {
      current = new Date(next)
    },
  }
}

function deps(visits: Visit[], clock: ReturnType<typeof fixedClock>) {
  const base = inMemoryEngineDeps({ visits, clients: [client] })
  return {
    ...base,
    clock,
    narratives: new InMemoryNarrativeStore(),
    evidence: new InMemoryEvidenceStore(),
  }
}

describe("event-processor handler", () => {
  it("flips the visit to arrived_on_time on a ding inside the window", async () => {
    const clock = fixedClock("2026-10-01T05:58:10.000Z")
    const d = deps([testVisit()], clock)
    const handler = createEventProcessor(d)
    await handler({
      Records: [
        {
          eventID: "1",
          eventName: "INSERT",
          eventVersion: "1.1",
          eventSource: "aws:dynamodb",
          eventSourceARN: "arn:table/stream",
          awsRegion: "us-east-1",
          dynamodb: {
            ApproximateCreationDateTime: 1786715596,
            Keys: {},
            NewImage: {
              ...doorEvent("2026-10-01T05:58:00.000Z", "ding"),
            } as unknown as Record<string, never>,
            StreamViewType: "NEW_AND_OLD_IMAGES",
          },
        },
      ],
    })
    expect((await d.visits.listForClient("c1"))[0]?.status).toBe("arrived_on_time")
  })

  it("skips unparseable stream records", async () => {
    const d = deps([testVisit()], fixedClock("2026-10-01T06:00:00.000Z"))
    const handler = createEventProcessor(d)
    await handler({
      Records: [
        {
          eventID: "1",
          eventName: "INSERT",
          eventVersion: "1.1",
          eventSource: "aws:dynamodb",
          eventSourceARN: "arn",
          awsRegion: "us-east-1",
          dynamodb: {
            ApproximateCreationDateTime: 1,
            Keys: {},
            NewImage: { garbage: { S: "true" } } as unknown as Record<string, never>,
            StreamViewType: "NEW_AND_OLD_IMAGES",
          },
        },
      ],
    })
    expect((await d.visits.listForClient("c1"))[0]?.status).toBe("awaiting_arrival")
  })
})

describe("visit-sweeper handler", () => {
  it("raises late_no_arrival, then no_show, without duplicating exceptions", async () => {
    const clock = fixedClock("2026-10-01T06:20:00.000Z")
    const d = deps([testVisit()], clock)
    const handler = createVisitSweeper(d)
    await handler({} as never)
    expect((await d.exceptions.listOpen()).map((e) => e.kind)).toEqual(["late_no_arrival"])

    clock.advanceTo("2026-10-01T06:50:00.000Z")
    await handler({} as never)
    const open = await d.exceptions.listOpen()
    expect(open.map((e) => e.kind)).toEqual(["no_show"])
    expect((await d.visits.listForClient("c1"))[0]?.status).toBe("no_show")
  })
})

describe("narrative-writer handler", () => {
  it("writes a template narrative for settled visits", async () => {
    const d = deps(
      [
        testVisit({
          status: "completed",
          arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" },
          departure: { at: "2026-10-01T08:05:00.000Z", source: "rule" },
        }),
      ],
      fixedClock("2026-10-01T09:00:00.000Z")
    )
    await createNarrativeWriter(d)()
    expect(d.narratives.narratives.get("v1")?.provenance).toBe("template")
    expect(d.narratives.narratives.get("v1")?.text).toContain("06:02")
  })
})

describe("snapshot-fetcher handler", () => {
  it("requests a snapshot 15 s after arrival when consent allows", async () => {
    const requested: string[] = []
    const d = deps(
      [testVisit({ status: "in_progress", arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })],
      fixedClock("2026-10-01T06:02:10.000Z")
    )
    d.snapshots = { request: async (visit) => void requested.push(visit.id) }
    await createSnapshotFetcher(d)()
    expect(requested).toEqual([])

    const later = deps(
      [testVisit({ status: "in_progress", arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })],
      fixedClock("2026-10-01T06:02:20.000Z")
    )
    const seen: string[] = []
    later.snapshots = { request: async (visit) => void seen.push(visit.id) }
    await createSnapshotFetcher(later)()
    expect(seen).toEqual(["v1"])
  })
})

describe("exporter handler", () => {
  it("writes the evidence pack and alternate EVV JSON", async () => {
    const d = deps(
      [testVisit({ status: "completed", arrival: { at: "2026-10-01T06:02:00.000Z", source: "rule" } })],
      fixedClock("2026-10-01T09:00:00.000Z")
    )
    const result = await createExporter(d)({ clientId: "c1", date: "2026-10-01" })
    expect(result.evidenceKey).toBe("evidence/c1/2026-10-01.json")
    const pack = JSON.parse(d.evidence.packs.get(result.evidenceKey) ?? "{}")
    expect(pack.clientName).toBe("Okoro Residence")
    expect(pack.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    const evv = JSON.parse(d.evidence.packs.get(result.evvKey) ?? "[]")
    expect(evv[0].VisitGUID).toBe("v1")
  })
})

describe("mailer handler", () => {
  it("sends an exception alert to family contacts with alerts on", async () => {
    const sent: { to: string; subject: string }[] = []
    const d = deps([testVisit()], fixedClock("2026-10-01T06:20:00.000Z"))
    d.mail = {
      send: async (input) => void sent.push({ to: input.to, subject: input.subject }),
    }
    await createVisitSweeper(d)({} as never)
    await createMailer(d)({ kind: "exception_alert", clientId: "c1" })
    expect(sent).toEqual([{ to: "priya@example.com", subject: "VisitProof Exception Alert" }])
  })

  it("sends nothing when consent has exception alerts off", async () => {
    const sent: unknown[] = []
    const d = deps([testVisit()], fixedClock("2026-10-01T06:20:00.000Z"))
    d.clients = {
      get: async () => ({ ...client, consent: { ...client.consent, exceptionAlerts: false } }),
    }
    d.mail = { send: async (input) => void sent.push(input) }
    await createMailer(d)({ kind: "exception_alert", clientId: "c1" })
    expect(sent).toEqual([])
  })
})
