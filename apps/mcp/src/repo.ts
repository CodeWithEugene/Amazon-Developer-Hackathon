import {
  type Caregiver,
  type Client,
  type DoorEvent,
  type Exception,
  type Visit,
} from "@visitproof/domain"

/**
 * Read-side repository contract for the MCP tools.
 *
 * Tools code against this narrow interface; {@link createDbVisitRepository}
 * in `./db-repo` adapts the real `@visitproof/db` `VisitProofRepository`
 * (used by the seeded demo store and production), while
 * {@link InMemoryVisitRepository} backs the offline fixture tests.
 */
export interface VisitRepository {
  /** The client the voice user is asking about (single-family default). */
  getDefaultClient(): Promise<Client | null>
  getClient(clientId: string): Promise<Client | null>
  getCaregiver(caregiverId: string): Promise<Caregiver | null>
  getVisit(visitId: string): Promise<Visit | null>
  /** Visits for a date (yyyy-mm-dd), optionally narrowed to one client. */
  listVisitsByDate(date: string, clientId?: string): Promise<Visit[]>
  /** Exceptions for a date (or all when omitted), optionally by state. */
  listExceptions(date?: string, state?: Exception["state"]): Promise<Exception[]>
  /** Door events relevant to a visit, ordered oldest first. */
  listDoorEvents(visitId: string): Promise<DoorEvent[]>
}

const isoDate = (value: string) => value.slice(0, 10)
export const DEMO_NOW = new Date("2026-09-27T16:00:00Z")
export const DEMO_TODAY = "2026-09-27"
const YESTERDAY = "2026-09-26"

const audit = (at: string) => ({ createdAt: at, updatedAt: at, version: 1 })

const clients: Client[] = [
  {
    ...audit("2026-09-13T09:00:00Z"),
    id: "client-okoro",
    agencyId: "agency-1",
    name: "Adaeze Okoro",
    homeLabel: "Maple Street",
    familyContacts: [{ name: "Priya Okoro", email: "priya@example.com" }],
    ringLinkStatus: "linked",
    consent: {
      shareWithAgency: true,
      snapshotsEnabled: true,
      snapshotRetentionDays: 14,
      digestHour: 19,
      exceptionAlerts: true,
    },
    serviceCodes: ["HOM-0200"],
  },
  {
    ...audit("2026-09-13T09:05:00Z"),
    id: "client-nakamura",
    agencyId: "agency-1",
    name: "Ken Nakamura",
    homeLabel: "Cedar Lane",
    familyContacts: [{ name: "Yuki Nakamura", email: "yuki@example.com" }],
    ringLinkStatus: "linked",
    consent: {
      shareWithAgency: true,
      snapshotsEnabled: false,
      snapshotRetentionDays: 7,
      digestHour: 19,
      exceptionAlerts: true,
    },
    serviceCodes: ["HOM-0200"],
  },
  {
    ...audit("2026-09-13T09:10:00Z"),
    id: "client-alvarez",
    agencyId: "agency-1",
    name: "Rosa Alvarez",
    homeLabel: "Birch Court",
    familyContacts: [{ name: "Diego Alvarez", email: "diego@example.com" }],
    ringLinkStatus: "linked",
    consent: {
      shareWithAgency: true,
      snapshotsEnabled: false,
      snapshotRetentionDays: 7,
      digestHour: 19,
      exceptionAlerts: true,
    },
    serviceCodes: ["RES-0050"],
  },
]

const caregivers: Record<string, Caregiver> = {
  "caregiver-maria": {
    ...audit("2026-09-13T09:00:00Z"),
    id: "caregiver-maria",
    agencyId: "agency-1",
    name: "Maria Santos",
    mobile: "+15550000001",
    email: "maria@example.com",
    evvEmployeeId: "EVV-1024",
  },
  "caregiver-james": {
    ...audit("2026-09-13T09:00:00Z"),
    id: "caregiver-james",
    agencyId: "agency-1",
    name: "James Odum",
    mobile: "+15550000002",
    evvEmployeeId: "EVV-1025",
  },
  "caregiver-aisha": {
    ...audit("2026-09-13T09:00:00Z"),
    id: "caregiver-aisha",
    agencyId: "agency-1",
    name: "Aisha Bello",
    mobile: "+15550000003",
    evvEmployeeId: "EVV-1026",
  },
}

const visits: Visit[] = [
  {
    ...audit("2026-09-25T08:00:00Z"),
    id: "visit-okoro-yesterday",
    clientId: "client-okoro",
    agencyId: "agency-1",
    caregiverId: "caregiver-maria",
    serviceCode: "HOM-0200",
    date: YESTERDAY,
    scheduledStart: "2026-09-26T10:00:00Z",
    scheduledEnd: "2026-09-26T11:00:00Z",
    status: "completed",
    arrival: { at: "2026-09-26T10:02:00Z", source: "rule" },
    departure: { at: "2026-09-26T10:58:00Z", source: "rule" },
    observability: { state: "observable", reasons: [] },
    reconciliation: {
      outcome: "corroborated",
      clockIn: "2026-09-26T10:04:00Z",
      clockOut: "2026-09-26T11:00:00Z",
      deltaArrivalMin: -2,
      deltaDepartureMin: -2,
    },
    narrative: {
      text: "Maria arrived at 10:02 AM and left at 10:58 AM. Her clock-in matches the door within 2 minutes.",
      provenance: "template",
      generatedAt: "2026-09-26T11:05:00Z",
    },
  },
  {
    ...audit("2026-09-27T07:00:00Z"),
    id: "visit-okoro-today",
    clientId: "client-okoro",
    agencyId: "agency-1",
    caregiverId: "caregiver-maria",
    serviceCode: "HOM-0200",
    date: DEMO_TODAY,
    scheduledStart: "2026-09-27T10:00:00Z",
    scheduledEnd: "2026-09-27T11:00:00Z",
    status: "completed",
    arrival: { at: "2026-09-27T10:02:00Z", source: "rule" },
    departure: { at: "2026-09-27T10:58:00Z", source: "rule" },
    observability: { state: "observable", reasons: [] },
    reconciliation: {
      outcome: "corroborated",
      clockIn: "2026-09-27T10:04:00Z",
      clockOut: "2026-09-27T11:00:00Z",
      deltaArrivalMin: -2,
      deltaDepartureMin: -2,
    },
    narrative: {
      text: "Maria arrived at 10:02 AM and left at 10:58 AM. Her clock-in matches the door within 2 minutes.",
      provenance: "template",
      generatedAt: "2026-09-27T11:05:00Z",
    },
  },
  {
    ...audit("2026-09-27T07:00:00Z"),
    id: "visit-nakamura-today",
    clientId: "client-nakamura",
    agencyId: "agency-1",
    caregiverId: "caregiver-james",
    serviceCode: "HOM-0200",
    date: DEMO_TODAY,
    scheduledStart: "2026-09-27T14:00:00Z",
    scheduledEnd: "2026-09-27T15:00:00Z",
    status: "arrived_late",
    arrival: { at: "2026-09-27T14:16:00Z", source: "rule" },
    observability: { state: "observable", reasons: [] },
    reconciliation: { outcome: "pending" },
  },
  {
    ...audit("2026-09-27T07:00:00Z"),
    id: "visit-alvarez-today",
    clientId: "client-alvarez",
    agencyId: "agency-1",
    caregiverId: "caregiver-aisha",
    serviceCode: "RES-0050",
    date: DEMO_TODAY,
    scheduledStart: "2026-09-27T09:00:00Z",
    scheduledEnd: "2026-09-27T10:00:00Z",
    status: "no_show",
    observability: { state: "observable", reasons: [] },
    reconciliation: { outcome: "missing_door" },
  },
]

const exceptions: Exception[] = [
  {
    ...audit("2026-09-27T09:46:00Z"),
    id: "exception-alvarez-noshow",
    agencyId: "agency-1",
    visitId: "visit-alvarez-today",
    clientId: "client-alvarez",
    kind: "no_show",
    state: "open",
    openedAt: "2026-09-27T09:46:00Z",
  },
  {
    ...audit("2026-09-27T14:16:00Z"),
    id: "exception-nakamura-late",
    agencyId: "agency-1",
    visitId: "visit-nakamura-today",
    clientId: "client-nakamura",
    kind: "late_arrival",
    state: "open",
    openedAt: "2026-09-27T14:16:00Z",
  },
  {
    ...audit("2026-09-26T11:10:00Z"),
    id: "exception-okoro-resolved",
    agencyId: "agency-1",
    visitId: "visit-okoro-yesterday",
    clientId: "client-okoro",
    kind: "missing_clock_in",
    state: "resolved",
    openedAt: "2026-09-26T11:10:00Z",
    resolution: {
      by: "agency",
      at: "2026-09-26T15:00:00Z",
      reason: "caregiver_clocked_in_late",
      note: "Clock-in confirmed 2 minutes after door arrival.",
    },
  },
]

const doorEvents: DoorEvent[] = [
  {
    ...audit("2026-09-27T10:02:11Z"),
    clientId: "client-okoro",
    requestId: "req-ding-1",
    timestampMs: Date.parse("2026-09-27T10:02:11Z"),
    at: "2026-09-27T10:02:11Z",
    type: "ding",
    subType: "human",
    deviceId: "device-okoro-door",
    provenance: "ring_webhook",
    rawPayloadHash: "hash-1",
    componentIds: [],
  },
  {
    ...audit("2026-09-27T10:57:40Z"),
    clientId: "client-okoro",
    requestId: "req-motion-1",
    timestampMs: Date.parse("2026-09-27T10:57:40Z"),
    at: "2026-09-27T10:57:40Z",
    type: "motion",
    subType: "human",
    deviceId: "device-okoro-door",
    provenance: "ring_webhook",
    rawPayloadHash: "hash-2",
    componentIds: [],
  },
]

/** Deterministic in-memory fixture repository backing the demo and tests. */
export class InMemoryVisitRepository implements VisitRepository {
  async getDefaultClient(): Promise<Client | null> {
    return clients[0] ?? null
  }

  async getClient(clientId: string): Promise<Client | null> {
    return clients.find((client) => client.id === clientId) ?? null
  }

  async getCaregiver(caregiverId: string): Promise<Caregiver | null> {
    return caregivers[caregiverId] ?? null
  }

  async getVisit(visitId: string): Promise<Visit | null> {
    return visits.find((visit) => visit.id === visitId) ?? null
  }

  async listVisitsByDate(date: string, clientId?: string): Promise<Visit[]> {
    return visits.filter(
      (visit) =>
        isoDate(visit.scheduledStart) === date &&
        (!clientId || visit.clientId === clientId),
    )
  }

  async listExceptions(
    date?: string,
    state?: Exception["state"],
  ): Promise<Exception[]> {
    return exceptions.filter(
      (exception) =>
        (!date || isoDate(exception.openedAt) === date) &&
        (!state || exception.state === state),
    )
  }

  async listDoorEvents(visitId: string): Promise<DoorEvent[]> {
    const visit = await this.getVisit(visitId)
    if (!visit) return []
    return doorEvents
      .filter((event) => event.clientId === visit.clientId)
      .filter((event) => {
        const at = Date.parse(event.at)
        const start = Date.parse(visit.scheduledStart) - 30 * 60 * 1000
        const end = Date.parse(visit.scheduledEnd) + 30 * 60 * 1000
        return at >= start && at <= end
      })
      .sort((a, b) => a.timestampMs - b.timestampMs)
  }
}

export const DEMO_REPO = new InMemoryVisitRepository()
