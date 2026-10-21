import type { VisitProofRepository } from "@visitproof/db"
import type { Client, DoorEvent, Exception, Visit } from "@visitproof/domain"

import type { AgencySettings, VisitRepository } from "./repo"
import { addDays, localDateKey } from "./time"

export interface DbVisitRepositoryOptions {
  /** The single agency the MCP server serves (matches the demo seed). */
  readonly agencyId: string
  /** Client the voice user is asking about; defaults to the first on the roster. */
  readonly defaultClientId?: string
  /**
   * Agency time zone and tolerances. The Agency entity is not in the
   * repository yet, so the caller supplies it (server.ts reads the demo
   * store's `agency.json`). Defaults to America/New_York and the defaults.
   */
  readonly settings?: AgencySettings | (() => Promise<AgencySettings>)
}

const DOOR_EVENT_MARGIN_MS = 30 * 60 * 1000
const FALLBACK_SETTINGS: AgencySettings = {
  timeZone: "America/New_York",
  tolerances: { graceMin: 15, escalationMin: 45, earlyDepartureMin: 10, departureQuietMin: 10 },
}

/** Every UTC calendar date a local date can overlap (the zone offset spans one day either way). */
const utcDatesFor = (from: string, to: string): string[] => {
  const dates: string[] = []
  for (let day = addDays(from, -1); day <= addDays(to, 1); day = addDays(day, 1)) {
    dates.push(day)
  }
  return dates
}

type StoreSource = VisitProofRepository | (() => VisitProofRepository)

/**
 * `VisitRepository` backed by the real `@visitproof/db` repository (the local
 * JSON store in the demo, DynamoDB in production), so the MCP tools answer
 * from the same data as the console. Pass a factory to get a fresh store per
 * call, which is how several processes share the local store directory.
 */
export const createDbVisitRepository = (
  source: StoreSource,
  options: DbVisitRepositoryOptions,
): VisitRepository => {
  const { agencyId } = options
  const store = (): VisitProofRepository => (typeof source === "function" ? source() : source)

  const settings = async (): Promise<AgencySettings> => {
    const configured = options.settings
    if (!configured) return FALLBACK_SETTINGS
    return typeof configured === "function" ? configured() : configured
  }

  const findVisit = async (visitId: string): Promise<Visit | null> => {
    const repo = store()
    for (const client of await repo.clients.byAgency(agencyId)) {
      const visit = await repo.visits.get(client.id, visitId)
      if (visit) return visit
    }
    return null
  }

  const visitsInRange = async (from: string, to: string, clientId?: string): Promise<Visit[]> => {
    const { timeZone } = await settings()
    const repo = store()
    const groups = await Promise.all(utcDatesFor(from, to).map((day) => repo.visits.byAgencyAndDate(agencyId, day)))
    const unique = new Map<string, Visit>()
    for (const visit of groups.flat()) {
      const local = localDateKey(visit.scheduledStart, timeZone)
      if (local < from || local > to) continue
      if (clientId && visit.clientId !== clientId) continue
      unique.set(`${visit.clientId}/${visit.id}`, visit)
    }
    return [...unique.values()].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  }

  const listExceptions = async (date?: string, state?: Exception["state"]): Promise<Exception[]> => {
    const exceptions = await store().exceptions.byAgency(agencyId, state)
    if (!date) return exceptions
    const visitIds = new Set((await visitsInRange(date, date)).map((visit) => visit.id))
    return exceptions.filter((exception) => visitIds.has(exception.visitId))
  }

  const listDoorEvents = async (visitId: string): Promise<DoorEvent[]> => {
    const visit = await findVisit(visitId)
    if (!visit) return []
    const start = Date.parse(visit.scheduledStart) - DOOR_EVENT_MARGIN_MS
    const end = Date.parse(visit.scheduledEnd) + DOOR_EVENT_MARGIN_MS
    const events = await store().events.byClient(visit.clientId, { sinceMs: start })
    return events.filter((event) => event.timestampMs <= end).sort((a, b) => a.timestampMs - b.timestampMs)
  }

  return {
    getAgencySettings: settings,

    async getDefaultClient(): Promise<Client | null> {
      const clients = await store().clients.byAgency(agencyId)
      const preferred = clients.find((client) => client.id === options.defaultClientId)
      return preferred ?? clients[0] ?? null
    },

    listClients: () => store().clients.byAgency(agencyId),
    getClient: (clientId) => store().clients.get(agencyId, clientId),
    getCaregiver: (caregiverId) => store().caregivers.get(agencyId, caregiverId),
    getVisit: findVisit,
    listVisitsByDate: (date, clientId) => visitsInRange(date, date, clientId),
    listVisitsInRange: visitsInRange,
    listExceptions,
    getException: (exceptionId) => store().exceptions.get(agencyId, exceptionId),
    listDoorEvents,
    listNotes: (visitId) => store().evidence.notesByVisit(visitId),
    listLedger: (clientId) => store().evidence.ledgerByClient(clientId),
    saveException: (exception) => store().exceptions.put(exception),
    saveNote: (note) => store().evidence.putNote(note),
    appendLedger: (record) => store().evidence.appendLedger(record),
  }
}
