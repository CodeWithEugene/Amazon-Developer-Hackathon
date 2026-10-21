import type {
  Caregiver,
  Client,
  DoorEvent,
  EVVRecord,
  Exception,
  LedgerRecord,
  Note,
  Snapshot,
  Visit,
} from "@visitproof/domain"

/** Deterministic entity builders shared by the repository test suites. */

const base = (now: string) => ({
  createdAt: now,
  updatedAt: now,
  version: 1,
})

const NOW = "2026-10-01T14:00:00.000Z"

export const makeClient = (overrides: Partial<Client> = {}): Client => ({
  ...base(NOW),
  id: "client-1",
  agencyId: "agency-1",
  name: "Amara Okoro",
  homeLabel: "Home",
  familyContacts: [
    { name: "Chidi Okoro", email: "chidi@example.com", relationship: "son" },
  ],
  ringLinkStatus: "linked",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: false,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
  },
  serviceCodes: ["HPCS"],
  ...overrides,
})

export const makeCaregiver = (
  overrides: Partial<Caregiver> = {}
): Caregiver => ({
  ...base(NOW),
  id: "cg-1",
  agencyId: "agency-1",
  name: "Rosa Alvarez",
  mobile: "+15550001111",
  email: "rosa@example.com",
  evvEmployeeId: "EVV-77",
  ...overrides,
})

export const makeVisit = (overrides: Partial<Visit> = {}): Visit => ({
  ...base(NOW),
  id: "visit-1",
  clientId: "client-1",
  agencyId: "agency-1",
  caregiverId: "cg-1",
  serviceCode: "HPCS",
  date: "2026-10-01",
  scheduledStart: "2026-10-01T14:00:00.000Z",
  scheduledEnd: "2026-10-01T16:00:00.000Z",
  authorizedUnits: 2,
  status: "scheduled",
  observability: { state: "observable", reasons: [] },
  ...overrides,
})

export const makeDoorEvent = (
  overrides: Partial<DoorEvent> = {}
): DoorEvent => ({
  ...base(NOW),
  clientId: "client-1",
  requestId: "req-1",
  timestampMs: 1_759_328_400_000,
  at: "2026-10-01T14:00:00.000Z",
  type: "motion",
  subType: "human",
  deviceId: "dev-1",
  provenance: "ring_webhook",
  rawPayloadHash: "a".repeat(64),
  componentIds: ["0"],
  ...overrides,
})

export const makeException = (
  overrides: Partial<Exception> = {}
): Exception => ({
  ...base(NOW),
  id: "exc-1",
  agencyId: "agency-1",
  visitId: "visit-1",
  clientId: "client-1",
  kind: "late_arrival",
  state: "open",
  openedAt: "2026-10-01T14:20:00.000Z",
  ...overrides,
})

export const makeEvvRecord = (
  overrides: Partial<EVVRecord> = {}
): EVVRecord => ({
  ...base(NOW),
  id: "evv-1",
  clientId: "client-1",
  agencyId: "agency-1",
  caregiverEvvId: "EVV-77",
  serviceCode: "HPCS",
  clockIn: "2026-10-01T14:03:00.000Z",
  clockOut: "2026-10-01T16:01:00.000Z",
  verificationMethod: "mobile_gps",
  lat: 40.7,
  lng: -74,
  source: "csv",
  ...overrides,
})

export const makeNote = (overrides: Partial<Note> = {}): Note => ({
  ...base(NOW),
  id: "note-1",
  visitId: "visit-1",
  authorRole: "family",
  authorId: "user-1",
  at: "2026-10-01T18:00:00.000Z",
  text: "Caregiver was on time.",
  classification: "fyi",
  ...overrides,
})

export const makeSnapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  ...base(NOW),
  visitId: "visit-1",
  at: "2026-10-01T14:00:15.000Z",
  s3Key: "snapshots/visit-1/1.jpg",
  mediaOrigin: "snapshot",
  labels: ["person"],
  watermarkBandPx: 48,
  requestedAt: "2026-10-01T14:00:00.000Z",
  provenance: "ring_webhook",
  ...overrides,
})

export const makeLedgerRecord = (
  seq: number,
  overrides: Partial<LedgerRecord> = {}
): LedgerRecord => ({
  clientId: "client-1",
  seq,
  column: "observed",
  subject: "visit-1",
  payloadHash: "b".repeat(64),
  prevHash: "0".repeat(64),
  signature: "sig",
  signerKeyId: "kms-key-1",
  at: NOW,
  ...overrides,
})
