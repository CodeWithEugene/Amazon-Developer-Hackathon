/**
 * Narrow ports the Lambda handlers depend on. Production wires these to
 * @visitproof/db (DynamoDB), SES, S3, and KMS; the demo and tests use the
 * in-memory defaults from ./defaults.
 */
import type {
  Agency,
  Client,
  DeviceStates,
  LedgerColumn,
  Snapshot,
  DoorEvent,
  EVVRecord,
  Exception,
  ExceptionResolution,
  Narrative,
  Visit,
} from "@visitproof/domain"

export interface Clock {
  now(): Date
}

export const systemClock: Clock = { now: () => new Date() }

export interface VisitStore {
  listForClient(clientId: string): Promise<Visit[]>
  listActive(): Promise<Visit[]>
  listAll(): Promise<Visit[]>
  save(visit: Visit): Promise<void>
}

export interface ClientStore {
  get(clientId: string): Promise<Client | undefined>
  /** Every client (daily digest fan-out). Optional for older wiring. */
  list?(): Promise<Client[]>
}

export interface DoorEventStore {
  append(event: DoorEvent): Promise<void>
  listForClient(clientId: string): Promise<DoorEvent[]>
}

export interface ExceptionStore {
  listOpen(): Promise<Exception[]>
  listForClient(clientId: string): Promise<Exception[]>
  open(exception: Exception): Promise<void>
  resolve(id: string, resolution: ExceptionResolution): Promise<void>
}

export interface EvvStore {
  listForClient(clientId: string): Promise<EVVRecord[]>
}

export interface NarrativeStore {
  save(visitId: string, narrative: Narrative): Promise<void>
}

export interface SnapshotService {
  request(visit: Visit): Promise<void>
}

/** Persisted Snapshot entities (docs/build.md Section 4). */
export interface SnapshotRecordStore {
  put(snapshot: Snapshot): Promise<void>
  listForVisit(visitId: string): Promise<Snapshot[]>
}

export interface EvidenceStore {
  put(key: string, body: string): Promise<void>
}

export interface MailTransport {
  send(input: { to: string; subject: string; text: string }): Promise<void>
}

/** Agency records, for per-agency tolerances and time zone. */
export interface AgencyStore {
  get(agencyId: string): Promise<Agency | undefined>
}

/** Structured warnings from handlers and adapters (no console.log). */
export interface Logger {
  warn(message: string, detail?: Record<string, unknown>): void
  error(message: string, detail?: Record<string, unknown>): void
  /** Evidence worth keeping in the logs (for example a Judge call). Optional. */
  info?(message: string, detail?: Record<string, unknown>): void
}

export const consoleLogger: Logger = {
  warn: (message, detail) => console.warn(message, detail ?? {}),
  error: (message, detail) => console.error(message, detail ?? {}),
  info: (message, detail) =>
    void process.stdout.write(
      `${JSON.stringify({ level: "info", message, ...detail })}\n`
    ),
}

/** One entry for the signed, hash-chained evidence ledger (EARS rule 10). */
export interface LedgerEntry {
  clientId: string
  column: LedgerColumn
  /** What the record is about: a door event request id, visit id, or exception id. */
  subject: string
  payload: unknown
  /** When the engine produced it (the engine clock). */
  at: Date
}

/**
 * Appends ledger records as the engine produces them: one observed record
 * per door event, per visit observation change, and per raised card, and
 * one resolved record per system resolution.
 */
export interface EvidenceLedger {
  append(entry: LedgerEntry): Promise<void>
}

/** Current device and integration state per client (the Ring device check). */
export interface DeviceStateSource {
  forClient(clientId: string, at: Date): Promise<DeviceStates | undefined>
}

export interface NarratorInput {
  visit: Visit
  caregiverName?: string
  now: Date
  /** Agency time zone (contract C1). */
  timeZone?: string
}

/** Writes one visit narrative (template, or Bedrock with template fallback). */
export interface Narrator {
  readonly name: "template" | "bedrock"
  write(input: NarratorInput): Promise<Narrative>
}

export interface EngineDeps {
  clock: Clock
  visits: VisitStore
  clients: ClientStore
  events: DoorEventStore
  exceptions: ExceptionStore
  evv: EvvStore
  narratives: NarrativeStore
  snapshots: SnapshotService
  evidence: EvidenceStore
  mail: MailTransport
  /** Per-agency tolerances; DEFAULT_TOLERANCES when absent (tests, demo). */
  agencies?: AgencyStore
  /** Narrative source; the deterministic template when absent. */
  narrator?: Narrator
  logger?: Logger
  /** Signed evidence ledger; nothing is appended when absent. */
  ledger?: EvidenceLedger
  /** Device check results for the observability overlay; omitted when absent. */
  devices?: DeviceStateSource
}
