import {
  DEFAULT_TOLERANCES,
  type Caregiver,
  type Client,
  type DoorEvent,
  type Exception,
  type LedgerRecord,
  type Note,
  type Tolerances,
  type Visit,
} from "@visitproof/domain"

import { createDbVisitRepository } from "./db-repo"
import {
  FIXTURE_AGENCY_ID,
  FIXTURE_NOW,
  FIXTURE_TODAY,
  fixtureSeed,
  type FixtureSeed,
} from "./fixtures"
import { createMemoryStore } from "./memory-store"

/** Agency settings the tools need: the display zone and the tolerances. */
export interface AgencySettings {
  readonly timeZone: string
  readonly tolerances: Tolerances
}

export const DEFAULT_AGENCY_SETTINGS: AgencySettings = {
  timeZone: "America/New_York",
  tolerances: DEFAULT_TOLERANCES,
}

/**
 * Repository contract for the MCP tools. Dates are agency-local calendar
 * dates (YYYY-MM-DD in the agency zone, contract C1), not UTC dates.
 *
 * {@link createDbVisitRepository} in `./db-repo` adapts the real
 * `@visitproof/db` `VisitProofRepository` (the seeded local store in the
 * demo, DynamoDB in production). The fixture server wraps the same adapter
 * around an in-memory store, so there is one code path.
 */
export interface VisitRepository {
  getAgencySettings(): Promise<AgencySettings>
  /** The client the voice user is asking about (single-family default). */
  getDefaultClient(): Promise<Client | null>
  listClients(): Promise<Client[]>
  getClient(clientId: string): Promise<Client | null>
  getCaregiver(caregiverId: string): Promise<Caregiver | null>
  getVisit(visitId: string): Promise<Visit | null>
  /** Visits on an agency-local date, optionally narrowed to one client. */
  listVisitsByDate(date: string, clientId?: string): Promise<Visit[]>
  /** Visits on agency-local dates from..to inclusive, by scheduled start. */
  listVisitsInRange(from: string, to: string, clientId?: string): Promise<Visit[]>
  /**
   * Exceptions whose visit falls on the agency-local date (or all when the
   * date is omitted), optionally by state.
   */
  listExceptions(date?: string, state?: Exception["state"]): Promise<Exception[]>
  getException(exceptionId: string): Promise<Exception | null>
  /** Door events relevant to a visit, ordered oldest first. */
  listDoorEvents(visitId: string): Promise<DoorEvent[]>
  listNotes(visitId: string): Promise<Note[]>
  listLedger(clientId: string): Promise<LedgerRecord[]>
  saveException(exception: Exception): Promise<void>
  saveNote(note: Note): Promise<void>
  appendLedger(record: LedgerRecord): Promise<void>
}

export const DEMO_NOW = FIXTURE_NOW
export const DEMO_TODAY = FIXTURE_TODAY

/** A fresh in-memory fixture repository (writes stay in this instance). */
export const createFixtureRepository = (seed: FixtureSeed = fixtureSeed()): VisitRepository => {
  const store = createMemoryStore(seed)
  return createDbVisitRepository(store, {
    agencyId: FIXTURE_AGENCY_ID,
    settings: { timeZone: seed.agency.timezone, tolerances: seed.agency.tolerances },
  })
}

/** Shared fixture repository used when no store is configured. */
export const DEMO_REPO: VisitRepository = createFixtureRepository()
