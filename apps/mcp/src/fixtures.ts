import {
  DEFAULT_TOLERANCES,
  signLedger,
  type Agency,
  type Caregiver,
  type Client,
  type DoorEvent,
  type Exception,
  type LedgerRecord,
  type Note,
  type Visit,
} from "@visitproof/domain"

import { DEMO_LEDGER_SIGNER } from "./signer"

/**
 * Offline fixture world with the same shape as the `pnpm demo` seed
 * (scripts/demo.ts): agency `a1` in America/New_York, clients `cli_*`,
 * caregivers `cg_*`, two visits per client per day, an unobservable visit
 * that still carries a rule-derived arrival, late visits that end as
 * `completed`, and exceptions opened for earlier visits. Times are UTC;
 * "today" is 2026-09-27 in the agency zone and the clock is 12:00 PM ET.
 */
export const FIXTURE_AGENCY_ID = "a1"
export const FIXTURE_NOW = new Date("2026-09-27T16:00:00.000Z")
export const FIXTURE_TODAY = "2026-09-27"

export interface FixtureSeed {
  readonly agency: Agency
  readonly clients: readonly Client[]
  readonly caregivers: readonly Caregiver[]
  readonly visits: readonly Visit[]
  readonly exceptions: readonly Exception[]
  readonly events: readonly DoorEvent[]
  readonly notes: readonly Note[]
  readonly ledger: readonly LedgerRecord[]
}

const audit = (at: string) => ({ createdAt: at, updatedAt: at, version: 1 })
const SEED_AT = "2026-09-14T00:00:00.000Z"

const agency: Agency = {
  ...audit(SEED_AT),
  id: FIXTURE_AGENCY_ID,
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: "America/New_York",
  tolerances: DEFAULT_TOLERANCES,
  retentionDays: 365,
  evvVendor: "State EVV Portal",
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
}

const client = (id: string, name: string, homeLabel: string, family: string): Client => ({
  ...audit(SEED_AT),
  id,
  agencyId: FIXTURE_AGENCY_ID,
  name,
  homeLabel,
  familyContacts: [{ name: family, email: `${id.replace("cli_", "")}@example.com` }],
  ringLinkStatus: "linked",
  consent: {
    shareWithAgency: true,
    snapshotsEnabled: false,
    snapshotRetentionDays: 7,
    digestHour: 19,
    exceptionAlerts: true,
    consentedAt: SEED_AT,
  },
  serviceCodes: ["T1019"],
})

const clients: Client[] = [
  client("cli_okoro", "Grace Okoro", "Maple Street", "Priya Okoro"),
  client("cli_nakamura", "Ken Nakamura", "Elm Court", "Mika Nakamura"),
  client("cli_alvarez", "Rosa Alvarez", "Cedar Avenue", "Luis Alvarez"),
]

const caregiver = (id: string, name: string, evv: string): Caregiver => ({
  ...audit(SEED_AT),
  id,
  agencyId: FIXTURE_AGENCY_ID,
  name,
  evvEmployeeId: evv,
})

const caregivers: Caregiver[] = [
  caregiver("cg_amara", "Amara Okafor", "EVV-1001"),
  caregiver("cg_daniel", "Daniel Reyes", "EVV-1002"),
  caregiver("cg_yuki", "Yuki Tanaka", "EVV-1003"),
  caregiver("cg_priya", "Priya Sharma", "EVV-1004"),
  caregiver("cg_marisol", "Marisol Vega", "EVV-1005"),
]

type VisitShape = Pick<Visit, "id" | "clientId" | "caregiverId" | "scheduledStart" | "scheduledEnd" | "status"> &
  Partial<Pick<Visit, "arrival" | "departure" | "observability" | "reconciliation" | "narrative">>

const visit = (shape: VisitShape): Visit => ({
  ...audit(shape.scheduledStart),
  agencyId: FIXTURE_AGENCY_ID,
  serviceCode: "T1019",
  date: shape.scheduledStart.slice(0, 10),
  observability: { state: "observable", reasons: [] },
  ...shape,
})

const at = (iso: string) => ({ at: iso, source: "rule" as const })

const visits: Visit[] = [
  // Yesterday (2026-09-26)
  visit({
    id: "v_okoro_24", clientId: "cli_okoro", caregiverId: "cg_amara",
    scheduledStart: "2026-09-26T12:00:00.000Z", scheduledEnd: "2026-09-26T14:00:00.000Z",
    status: "completed", arrival: at("2026-09-26T12:20:00.000Z"), departure: at("2026-09-26T14:02:00.000Z"),
    reconciliation: { outcome: "corroborated", clockIn: "2026-09-26T12:22:00.000Z", clockOut: "2026-09-26T14:02:00.000Z" },
  }),
  visit({
    id: "v_nakamura_24", clientId: "cli_nakamura", caregiverId: "cg_yuki",
    scheduledStart: "2026-09-26T13:00:00.000Z", scheduledEnd: "2026-09-26T15:00:00.000Z",
    status: "completed", arrival: at("2026-09-26T13:01:00.000Z"), departure: at("2026-09-26T15:00:05.000Z"),
    reconciliation: { outcome: "missing_clock_in" },
  }),
  // Today (2026-09-27, ET)
  visit({
    id: "v_okoro_26", clientId: "cli_okoro", caregiverId: "cg_amara",
    scheduledStart: "2026-09-27T12:00:00.000Z", scheduledEnd: "2026-09-27T14:00:00.000Z",
    status: "completed", arrival: at("2026-09-27T12:04:00.000Z"), departure: at("2026-09-27T13:58:00.000Z"),
    reconciliation: {
      outcome: "corroborated", clockIn: "2026-09-27T12:06:00.000Z", clockOut: "2026-09-27T14:00:00.000Z",
      deltaArrivalMin: 2, deltaDepartureMin: 2,
    },
  }),
  visit({
    id: "v_okoro_27", clientId: "cli_okoro", caregiverId: "cg_daniel",
    scheduledStart: "2026-09-27T18:00:00.000Z", scheduledEnd: "2026-09-27T20:00:00.000Z",
    status: "scheduled",
  }),
  visit({
    id: "v_nakamura_26", clientId: "cli_nakamura", caregiverId: "cg_yuki",
    scheduledStart: "2026-09-27T09:00:00.000Z", scheduledEnd: "2026-09-27T11:00:00.000Z",
    status: "unobservable", arrival: at("2026-09-27T09:00:00.000Z"),
    observability: { state: "unobservable", reasons: ["device_offline"] },
    reconciliation: { outcome: "unobservable" },
  }),
  visit({
    id: "v_nakamura_27", clientId: "cli_nakamura", caregiverId: "cg_priya",
    scheduledStart: "2026-09-27T13:00:00.000Z", scheduledEnd: "2026-09-27T15:00:00.000Z",
    status: "completed", arrival: at("2026-09-27T13:22:00.000Z"), departure: at("2026-09-27T15:05:00.000Z"),
    reconciliation: { outcome: "corroborated", clockIn: "2026-09-27T13:25:00.000Z", clockOut: "2026-09-27T15:05:00.000Z" },
  }),
  visit({
    id: "v_alvarez_26", clientId: "cli_alvarez", caregiverId: "cg_marisol",
    scheduledStart: "2026-09-27T11:00:00.000Z", scheduledEnd: "2026-09-27T13:00:00.000Z",
    status: "no_show", reconciliation: { outcome: "missing_both" },
  }),
  visit({
    id: "v_alvarez_27", clientId: "cli_alvarez", caregiverId: "cg_marisol",
    scheduledStart: "2026-09-27T15:30:00.000Z", scheduledEnd: "2026-09-27T17:30:00.000Z",
    status: "awaiting_arrival",
  }),
]

const exception = (
  visitId: string,
  clientId: string,
  kind: Exception["kind"],
  openedAt: string,
  resolution?: Exception["resolution"],
): Exception => ({
  ...audit(openedAt),
  id: `${visitId}#${kind}`,
  agencyId: FIXTURE_AGENCY_ID,
  visitId,
  clientId,
  kind,
  state: resolution ? "resolved" : "open",
  openedAt,
  ...(resolution ? { resolution } : {}),
})

const exceptions: Exception[] = [
  exception("v_okoro_24", "cli_okoro", "late_arrival", "2026-09-26T12:20:00.000Z", {
    by: "agency", at: "2026-09-26T15:00:00.000Z", reason: "traffic_delay",
  }),
  // Opened today by the engine for yesterday's visit: must not count as today's.
  exception("v_nakamura_24", "cli_nakamura", "missing_clock_in", "2026-09-27T10:00:00.000Z"),
  exception("v_nakamura_26", "cli_nakamura", "unobservable", "2026-09-27T09:30:00.000Z"),
  exception("v_nakamura_27", "cli_nakamura", "late_arrival", "2026-09-27T13:22:00.000Z"),
  exception("v_alvarez_26", "cli_alvarez", "late_no_arrival", "2026-09-27T11:15:00.000Z", {
    by: "system", at: "2026-09-27T11:45:00.000Z", reason: "superseded",
  }),
  exception("v_alvarez_26", "cli_alvarez", "no_show", "2026-09-27T11:45:00.000Z"),
  exception("v_alvarez_27", "cli_alvarez", "late_no_arrival", "2026-09-27T15:45:00.000Z"),
]

const doorEvent = (
  clientId: string,
  requestId: string,
  iso: string,
  type: DoorEvent["type"],
  subType?: string,
): DoorEvent => ({
  ...audit(iso),
  clientId,
  requestId,
  timestampMs: Date.parse(iso),
  at: iso,
  type,
  ...(subType ? { subType } : {}),
  deviceId: `dev_${clientId.replace("cli_", "")}_front`,
  provenance: "emulated",
  rawPayloadHash: `hash-${requestId}`,
  componentIds: [],
})

const events: DoorEvent[] = [
  doorEvent("cli_okoro", "req-okoro-1", "2026-09-27T12:03:40.000Z", "motion", "human"),
  doorEvent("cli_okoro", "req-okoro-2", "2026-09-27T12:04:00.000Z", "ding"),
  doorEvent("cli_okoro", "req-okoro-3", "2026-09-27T13:58:00.000Z", "motion", "human"),
  doorEvent("cli_nakamura", "req-nakamura-1", "2026-09-27T09:00:00.000Z", "ding"),
  doorEvent("cli_nakamura", "req-nakamura-2", "2026-09-27T09:30:00.000Z", "device_offline"),
]

const notes: Note[] = [
  {
    ...audit("2026-09-27T13:30:00.000Z"),
    id: "note_caregiver_roadwork",
    visitId: "v_nakamura_27",
    authorRole: "caregiver",
    authorId: "cg_priya",
    at: "2026-09-27T13:30:00.000Z",
    text: "I was delayed by road work and arrived as soon as I could.",
    classification: "explanation",
  },
]

const buildLedger = (): LedgerRecord[] => {
  const entries = [
    { column: "observed" as const, subject: "v_okoro_26", at: "2026-09-27T13:58:00.000Z", payload: { status: "completed" } },
    { column: "reported" as const, subject: "evv_v_okoro_26", at: "2026-09-27T12:06:00.000Z", payload: { clockIn: "2026-09-27T12:06:00.000Z" } },
  ]
  const records: LedgerRecord[] = []
  for (const [index, entry] of entries.entries()) {
    const prev = records.at(-1)
    records.push(
      signLedger({
        clientId: "cli_okoro",
        seq: index + 1,
        column: entry.column,
        subject: entry.subject,
        payload: entry.payload,
        signerKeyId: DEMO_LEDGER_SIGNER.keyId,
        at: entry.at,
        ...(prev ? { prev } : {}),
        sign: DEMO_LEDGER_SIGNER.sign,
      }),
    )
  }
  return records
}

/** A fresh copy of the fixture world (callers may mutate their copy). */
export const fixtureSeed = (): FixtureSeed =>
  structuredClone({ agency, clients, caregivers, visits, exceptions, events, notes, ledger: buildLedger() })
