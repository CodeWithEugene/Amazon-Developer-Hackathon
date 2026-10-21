import type {
  Agency,
  Caregiver,
  Client,
  Consent,
  DoorEvent,
  EVVRecord,
  Exception,
  ExceptionState,
  Id,
  LedgerRecord,
  Note,
  Snapshot,
  Visit,
} from "@visitproof/domain"

/**
 * The persistence contract for VisitProof (docs/build.md Section 4). Every
 * consumer (webhook receiver, engine, console) codes against this interface;
 * `createLocalRepository` backs the offline demo and tests, and
 * `createDynamoRepository` backs production.
 */
export interface VisitProofRepository {
  /**
   * Agency records (`AGENCY#id` / `META`). Optional so existing test doubles
   * keep compiling; both built-in repositories implement it. The local
   * repository falls back to the demo's single-object `agency.json`.
   */
  readonly agencies?: {
    put(agency: Agency): Promise<void>
    get(agencyId: Id): Promise<Agency | null>
  }

  readonly visits: {
    /** Upsert by (clientId, id). */
    put(visit: Visit): Promise<void>
    get(clientId: Id, visitId: Id): Promise<Visit | null>
    /** Visits of a client, newest scheduled start first. */
    byClient(clientId: Id): Promise<Visit[]>
    /** Visits of an agency on a calendar date (yyyy-mm-dd), by start time. */
    byAgencyAndDate(agencyId: Id, date: string): Promise<Visit[]>
  }

  readonly events: {
    /**
     * Idempotent upsert keyed on (clientId, timestampMs, requestId); Ring
     * retries reuse the same request id and are safely absorbed.
     */
    put(event: DoorEvent): Promise<void>
    byClient(
      clientId: Id,
      options?: { sinceMs?: number; limit?: number }
    ): Promise<DoorEvent[]>
    /**
     * Deletes every door event of a client ("Delete Everything", contract
     * C3); returns the number removed. Optional for test doubles.
     */
    deleteByClient?(clientId: Id): Promise<number>
  }

  readonly exceptions: {
    put(exception: Exception): Promise<void>
    get(agencyId: Id, exceptionId: Id): Promise<Exception | null>
    /** Exceptions of an agency, optionally filtered by state, newest first. */
    byAgency(agencyId: Id, state?: ExceptionState): Promise<Exception[]>
  }

  readonly caregivers: {
    put(caregiver: Caregiver): Promise<void>
    get(agencyId: Id, caregiverId: Id): Promise<Caregiver | null>
    byAgency(agencyId: Id): Promise<Caregiver[]>
  }

  readonly clients: {
    put(client: Client): Promise<void>
    get(agencyId: Id, clientId: Id): Promise<Client | null>
    byAgency(agencyId: Id): Promise<Client[]>
    /** Read-modify-write of the consent record; returns the updated client. */
    saveConsent(
      agencyId: Id,
      clientId: Id,
      consent: Consent,
      now: Date
    ): Promise<Client>
  }

  /** Ring account to client resolution used by the webhook receiver. */
  readonly ringLinks: {
    link(clientId: Id, accountId: string, now: Date): Promise<void>
    unlink(accountId: string): Promise<void>
    clientIdFor(accountId: string): Promise<Id | null>
  }

  readonly evvRecords: {
    put(record: EVVRecord): Promise<void>
    get(clientId: Id, recordId: Id): Promise<EVVRecord | null>
    byClient(clientId: Id): Promise<EVVRecord[]>
  }

  readonly evidence: {
    putNote(note: Note): Promise<void>
    notesByVisit(visitId: Id): Promise<Note[]>
    putSnapshot(snapshot: Snapshot): Promise<void>
    snapshotsByVisit(visitId: Id): Promise<Snapshot[]>
    /**
     * Deletes the notes and snapshot records of a visit ("Delete
     * Everything", contract C3). The ledger is append-only and never
     * deleted. Optional for test doubles.
     */
    deleteByVisit?(visitId: Id): Promise<{ notes: number; snapshots: number }>
    /**
     * Appends to the per-client hash chain; rejects a seq that already exists
     * so the ledger stays append-only.
     */
    appendLedger(record: LedgerRecord): Promise<void>
    ledgerByClient(clientId: Id): Promise<LedgerRecord[]>
  }

  readonly webhookReceipts: {
    /**
     * Conditional put on the Ring request id. Returns true when this call
     * claimed the id (first delivery) and false when it was already seen
     * (a replay or retry).
     */
    claim(requestId: string, now: Date): Promise<boolean>
  }
}
