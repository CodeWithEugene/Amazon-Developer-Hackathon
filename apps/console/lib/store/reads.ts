import "server-only"

import type {
  Caregiver,
  Client,
  EVVRecord,
  Exception,
  LedgerRecord,
  Note,
  Visit,
} from "@visitproof/domain"

import { addDaysToKey, localDateKey } from "@/lib/time"

import { getAgencyTimeZone } from "./agency"
import { pickCaregiverPersona } from "./persona"
import { AGENCY_ID, getStore } from "./repository"

export const listClients = (): Promise<Client[]> =>
  getStore().clients.byAgency(AGENCY_ID)

export const listCaregivers = (): Promise<Caregiver[]> =>
  getStore().caregivers.byAgency(AGENCY_ID)

/** Today's date key in the agency time zone (contract C1). */
export async function agencyToday(now: Date = new Date()): Promise<string> {
  return localDateKey(now, await getAgencyTimeZone())
}

/**
 * Visits on an agency-local calendar date (default: today). The stored
 * `date` may be the UTC date, so neighbouring days are read and filtered
 * by the local date of the scheduled start.
 */
export async function listVisits(date?: string): Promise<Visit[]> {
  const timeZone = await getAgencyTimeZone()
  const day = date ?? localDateKey(new Date(), timeZone)
  const store = getStore()
  const groups = await Promise.all(
    [-1, 0, 1].map((offset) =>
      store.visits.byAgencyAndDate(AGENCY_ID, addDaysToKey(day, offset))
    )
  )
  const unique = new Map(groups.flat().map((visit) => [visit.id, visit]))
  return [...unique.values()]
    .filter((visit) => localDateKey(visit.scheduledStart, timeZone) === day)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
}

/** Every visit of every client on the roster, newest first. */
export async function listAllVisits(): Promise<Visit[]> {
  const store = getStore()
  const clients = await store.clients.byAgency(AGENCY_ID)
  const groups = await Promise.all(
    clients.map((client) => store.visits.byClient(client.id))
  )
  return groups
    .flat()
    .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
}

/** Visits whose agency-local date falls in the last `days` days. */
export async function listRecentVisits(
  days: number,
  now: Date = new Date()
): Promise<Visit[]> {
  const timeZone = await getAgencyTimeZone()
  const today = localDateKey(now, timeZone)
  const first = addDaysToKey(today, -(days - 1))
  return (await listAllVisits()).filter((visit) => {
    const key = localDateKey(visit.scheduledStart, timeZone)
    return key >= first && key <= today
  })
}

export async function listExceptions(
  states?: Exception["state"][]
): Promise<Exception[]> {
  const store = getStore()
  if (!states) return store.exceptions.byAgency(AGENCY_ID)
  const groups = await Promise.all(
    states.map((state) => store.exceptions.byAgency(AGENCY_ID, state))
  )
  return groups.flat().sort((a, b) => b.openedAt.localeCompare(a.openedAt))
}

export async function getVisit(visitId: string): Promise<Visit | null> {
  const store = getStore()
  for (const client of await store.clients.byAgency(AGENCY_ID)) {
    const visit = await store.visits.get(client.id, visitId)
    if (visit) return visit
  }
  return null
}

export const getClient = (clientId: string): Promise<Client | null> =>
  getStore().clients.get(AGENCY_ID, clientId)

export const listNotes = (visitId: string): Promise<Note[]> =>
  getStore().evidence.notesByVisit(visitId)

export async function listEvvRecords(): Promise<EVVRecord[]> {
  const store = getStore()
  const clients = await store.clients.byAgency(AGENCY_ID)
  const groups = await Promise.all(
    clients.map((c) => store.evvRecords.byClient(c.id))
  )
  return groups.flat()
}

export const listLedgerRecords = (clientId: string): Promise<LedgerRecord[]> =>
  getStore().evidence.ledgerByClient(clientId)

/**
 * Demo persona bindings. The mock sign-in carries only a role, so each
 * family or caregiver session is bound to a fixed persona on the roster:
 * the family sees the first client; the caregiver is the one whose recent
 * record has a missing clock-in with door presence, so the dispute story
 * has something to dispute. API routes must scope writes to these ids.
 */
export async function getSessionClientId(): Promise<string | undefined> {
  return (await listClients())[0]?.id
}

export async function getSessionCaregiverId(): Promise<string | undefined> {
  const [visits, caregivers] = await Promise.all([
    listRecentVisits(14),
    listCaregivers(),
  ])
  return pickCaregiverPersona(visits, caregivers)
}
