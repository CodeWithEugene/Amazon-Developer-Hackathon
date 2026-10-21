import {
  doorEventSchema,
  type Agency,
  type Client,
  type DoorEvent,
  type Visit,
} from "@visitproof/domain"
import type { DynamoDBRecord } from "aws-lambda"

import { inMemoryEngineDeps, type EngineDeps, type Logger } from "../src"

export const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
}

let seq = 0
export function doorEvent(
  at: string,
  type: DoorEvent["type"],
  overrides: Partial<DoorEvent> = {}
): DoorEvent {
  seq += 1
  return doorEventSchema.parse({
    ...audit,
    clientId: "c1",
    requestId: `req-${seq}`,
    timestampMs: Date.parse(at),
    at,
    type,
    deviceId: "dev-1",
    provenance: "emulated",
    rawPayloadHash: `h${seq}`,
    ...overrides,
  })
}

export function testVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    ...audit,
    id: "v1",
    clientId: "c1",
    agencyId: "a1",
    caregiverId: "cg1",
    serviceCode: "T1019",
    date: "2026-10-01",
    scheduledStart: "2026-10-01T12:00:00.000Z",
    scheduledEnd: "2026-10-01T14:00:00.000Z",
    status: "awaiting_arrival",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

export const testClient = (overrides: Partial<Client> = {}): Client => ({
  ...audit,
  id: "c1",
  agencyId: "a1",
  name: "Okoro Residence",
  homeLabel: "Home",
  familyContacts: [
    {
      name: "Priya Okoro",
      email: "priya@example.com",
      relationship: "daughter",
    },
  ],
  ringLinkStatus: "linked",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: true,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["T1019"],
  ...overrides,
})

export const testAgency = (overrides: Partial<Agency> = {}): Agency => ({
  ...audit,
  id: "a1",
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: "America/New_York",
  tolerances: {
    graceMin: 15,
    escalationMin: 45,
    earlyDepartureMin: 10,
    departureQuietMin: 10,
  },
  retentionDays: 365,
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
  ...overrides,
})

export const silentLogger = (): Logger & {
  warnings: string[]
  errors: string[]
} => {
  const warnings: string[] = []
  const errors: string[] = []
  return {
    warnings,
    errors,
    warn: (message) => void warnings.push(message),
    error: (message) => void errors.push(message),
  }
}

export function testDeps(
  at: string,
  options: { visits?: Visit[]; clients?: Client[]; agency?: Agency } = {}
): EngineDeps {
  const base = inMemoryEngineDeps({
    visits: options.visits ?? [testVisit()],
    clients: options.clients ?? [testClient()],
  })
  const agency = options.agency
  return {
    ...base,
    clock: { now: () => new Date(at) },
    logger: silentLogger(),
    ...(agency
      ? {
          agencies: {
            get: async (id: string) => (id === agency.id ? agency : undefined),
          },
        }
      : {}),
  }
}

export function streamRecord(
  image: Record<string, unknown>,
  sequence: string
): DynamoDBRecord {
  return {
    eventID: `evt-${sequence}`,
    eventName: "INSERT",
    eventSource: "aws:dynamodb",
    awsRegion: "us-east-1",
    dynamodb: {
      SequenceNumber: sequence,
      NewImage: image as never,
      StreamViewType: "NEW_AND_OLD_IMAGES",
    },
  }
}
