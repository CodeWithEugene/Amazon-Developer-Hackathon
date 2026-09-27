/**
 * In-memory default implementations of the engine ports. Used by the demo
 * studio, local webhooks, and tests; production handlers inject DynamoDB,
 * S3, SES, and KMS backed stores instead.
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

import type {
  ClientStore,
  DoorEventStore,
  EngineDeps,
  EvidenceStore,
  ExceptionStore,
  MailTransport,
  SnapshotService,
  VisitStore,
} from "./ports"
import type { EvvStore, NarrativeStore } from "./ports"

export class InMemoryVisitStore implements VisitStore {
  constructor(private readonly visits: Visit[] = []) {}
  async listForClient(clientId: string): Promise<Visit[]> {
    return this.visits.filter((visit) => visit.clientId === clientId)
  }
  async listActive(): Promise<Visit[]> {
    return this.visits.filter(
      (visit) =>
        visit.status !== "completed" &&
        visit.status !== "early_departure" &&
        visit.status !== "departure_not_observed"
    )
  }
  async listAll(): Promise<Visit[]> {
    return [...this.visits]
  }
  async save(visit: Visit): Promise<void> {
    const index = this.visits.findIndex((existing) => existing.id === visit.id)
    if (index >= 0) this.visits[index] = visit
    else this.visits.push(visit)
  }
}

export class InMemoryClientStore implements ClientStore {
  constructor(private readonly clients: Client[] = []) {}
  async get(clientId: string): Promise<Client | undefined> {
    return this.clients.find((client) => client.id === clientId)
  }
}

export class InMemoryDoorEventStore implements DoorEventStore {
  readonly events: DoorEvent[] = []
  async append(event: DoorEvent): Promise<void> {
    this.events.push(event)
  }
  async listForClient(clientId: string): Promise<DoorEvent[]> {
    return this.events.filter((event) => event.clientId === clientId)
  }
}

export class InMemoryExceptionStore implements ExceptionStore {
  readonly exceptions: Exception[] = []
  async listOpen(): Promise<Exception[]> {
    return this.exceptions.filter((exception) => exception.state === "open")
  }
  async listForClient(clientId: string): Promise<Exception[]> {
    return this.exceptions.filter((exception) => exception.clientId === clientId)
  }
  async open(exception: Exception): Promise<void> {
    this.exceptions.push(exception)
  }
  async resolve(id: string, resolution: ExceptionResolution): Promise<void> {
    const exception = this.exceptions.find((existing) => existing.id === id)
    if (exception) {
      exception.state = "resolved"
      exception.resolution = resolution
      exception.updatedAt = resolution.at
    }
  }
}

export class InMemoryEvvStore implements EvvStore {
  constructor(private readonly records: EVVRecord[] = []) {}
  async listForClient(clientId: string): Promise<EVVRecord[]> {
    return this.records.filter((record) => record.clientId === clientId)
  }
}

export class InMemoryNarrativeStore implements NarrativeStore {
  readonly narratives = new Map<string, Narrative>()
  async save(visitId: string, narrative: Narrative): Promise<void> {
    this.narratives.set(visitId, narrative)
  }
}

export class NoopSnapshotService implements SnapshotService {
  async request(): Promise<void> {}
}

export class InMemoryEvidenceStore implements EvidenceStore {
  readonly packs = new Map<string, string>()
  async put(key: string, body: string): Promise<void> {
    this.packs.set(key, body)
  }
}

/** Fixture transport: logs instead of sending (demo mode). */
export const consoleMailTransport: MailTransport = {
  async send(input) {
    console.warn(`[mailer] to=${input.to} subject="${input.subject}"`)
  },
}

export interface InMemoryEngineOptions {
  visits?: Visit[]
  clients?: Client[]
  events?: DoorEvent[]
  exceptions?: Exception[]
  evvRecords?: EVVRecord[]
}

export function inMemoryEngineDeps(options: InMemoryEngineOptions = {}): EngineDeps {
  return {
    clock: { now: () => new Date() },
    visits: new InMemoryVisitStore(options.visits ?? []),
    clients: new InMemoryClientStore(options.clients ?? []),
    events: new InMemoryDoorEventStore(),
    exceptions: new InMemoryExceptionStore(),
    evv: new InMemoryEvvStore(options.evvRecords ?? []),
    narratives: new InMemoryNarrativeStore(),
    snapshots: new NoopSnapshotService(),
    evidence: new InMemoryEvidenceStore(),
    mail: consoleMailTransport,
  }
}
