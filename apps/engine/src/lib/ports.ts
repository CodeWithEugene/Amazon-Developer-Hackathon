/**
 * Narrow ports the Lambda handlers depend on. Production wires these to
 * @visitproof/db (DynamoDB), SES, S3, and KMS; the demo and tests use the
 * in-memory defaults from ./defaults.
 */
import type {
  Client,
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

export interface EvidenceStore {
  put(key: string, body: string): Promise<void>
}

export interface MailTransport {
  send(input: { to: string; subject: string; text: string }): Promise<void>
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
}
