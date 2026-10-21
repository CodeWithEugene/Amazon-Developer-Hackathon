import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository, type VisitProofRepository } from "@visitproof/db"
import type {
  Agency,
  Caregiver,
  Client,
  DoorEvent,
  EVVRecord,
  Exception,
  Visit,
} from "@visitproof/domain"

export const TZ = "America/New_York"
const AUDIT = { createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z", version: 1 }
const HOUR = 3_600_000
const DAY = 24 * HOUR

export const agency: Agency = {
  ...AUDIT,
  id: "a1",
  name: "Test Home Care",
  state: "OH",
  timezone: TZ,
  tolerances: { graceMin: 15, escalationMin: 45, earlyDepartureMin: 10, departureQuietMin: 10 },
  retentionDays: 365,
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
}

export const client = (id: string, name: string, overrides: Partial<Client> = {}): Client => ({
  ...AUDIT,
  id,
  agencyId: "a1",
  name,
  homeLabel: `${name} Home`,
  familyContacts: [],
  ringLinkStatus: "linked",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: false,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["T1019"],
  ...overrides,
})

export const caregiver = (id: string, name: string): Caregiver => ({
  ...AUDIT,
  id,
  agencyId: "a1",
  name,
  mobile: "+15555550100",
})

/** A visit starting at `start` for two hours, completed with door times. */
export function visit(
  id: string,
  clientId: string,
  caregiverId: string,
  start: Date,
  overrides: Partial<Visit> = {}
): Visit {
  const startIso = start.toISOString()
  const endIso = new Date(start.getTime() + 2 * HOUR).toISOString()
  return {
    ...AUDIT,
    id,
    clientId,
    agencyId: "a1",
    caregiverId,
    serviceCode: "T1019",
    date: startIso.slice(0, 10),
    scheduledStart: startIso,
    scheduledEnd: endIso,
    status: "completed",
    observability: { state: "observable", reasons: [] },
    arrival: { at: startIso, eventId: `evt_${id}_a`, source: "rule", confidence: 0.9 },
    departure: { at: endIso, eventId: `evt_${id}_d`, source: "rule" },
    reconciliation: { outcome: "corroborated", clockIn: startIso, clockOut: endIso, deltaArrivalMin: 0, deltaDepartureMin: 0 },
    ...overrides,
  }
}

export const doorEvent = (v: Visit, suffix: "a" | "d"): DoorEvent => {
  const at = suffix === "a" ? v.scheduledStart : v.scheduledEnd
  return {
    ...AUDIT,
    clientId: v.clientId,
    requestId: `evt_${v.id}_${suffix}`,
    timestampMs: Date.parse(at),
    at,
    type: suffix === "a" ? "ding" : "motion",
    subType: suffix === "a" ? "button_press" : "human",
    provenance: "emulated",
    rawPayloadHash: `hash_${v.id}_${suffix}`,
    componentIds: [],
  }
}

export const evv = (v: Visit): EVVRecord => ({
  ...AUDIT,
  id: `evv_${v.id}`,
  clientId: v.clientId,
  agencyId: "a1",
  caregiverEvvId: "E1",
  serviceCode: "T1019",
  clockIn: v.scheduledStart,
  clockOut: v.scheduledEnd,
  source: "csv",
  visitId: v.id,
})

export const exception = (v: Visit, kind: Exception["kind"], overrides: Partial<Exception> = {}): Exception => ({
  ...AUDIT,
  id: `${v.id}#${kind}`,
  agencyId: "a1",
  visitId: v.id,
  clientId: v.clientId,
  kind,
  state: "open",
  openedAt: v.scheduledStart,
  ...overrides,
})

/** 9:00 AM Eastern (13:00Z during EDT) on the day `daysAgo` before `now`. */
export const nineAmEastern = (now: Date, daysAgo: number): Date => {
  const base = new Date(now.getTime() - daysAgo * DAY)
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 13, 0))
}

export interface TestStore {
  dir: string
  repo: VisitProofRepository
  cleanup: () => Promise<void>
}

/** A temp-directory local repository wired to the console via env. */
export async function createTestStore(): Promise<TestStore> {
  const dir = await mkdtemp(join(tmpdir(), "visitproof-console-"))
  process.env.VISITPROOF_DEMO_STORE_PATH = dir
  await writeFile(join(dir, "agency.json"), JSON.stringify(agency), "utf8")
  return {
    dir,
    repo: createLocalRepository(dir),
    cleanup: async () => {
      delete process.env.VISITPROOF_DEMO_STORE_PATH
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export interface Seeded {
  visits: Visit[]
  okoro: Client
}

/**
 * Two clients and two caregivers; Okoro has one visit a day for 14 days
 * ending today, each with door events and an EVV record.
 */
export async function seedTwoWeeks(repo: VisitProofRepository, now: Date): Promise<Seeded> {
  const okoro = client("cli_okoro", "Grace Okoro")
  await repo.clients.put(okoro)
  await repo.clients.put(client("cli_ken", "Ken Nakamura"))
  await repo.caregivers.put(caregiver("cg_amara", "Amara Okafor"))
  await repo.caregivers.put(caregiver("cg_daniel", "Daniel Reyes"))
  const visits = Array.from({ length: 14 }, (_, index) =>
    visit(`v_okoro_${String(index).padStart(2, "0")}`, "cli_okoro", "cg_amara", nineAmEastern(now, 13 - index))
  )
  for (const v of visits) {
    await repo.visits.put(v)
    await repo.events.put(doorEvent(v, "a"))
    await repo.events.put(doorEvent(v, "d"))
    await repo.evvRecords.put(evv(v))
  }
  return { visits, okoro }
}
