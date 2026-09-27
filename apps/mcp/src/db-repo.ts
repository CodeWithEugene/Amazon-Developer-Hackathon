import type { VisitProofRepository } from "@visitproof/db"
import type { Caregiver, Client, DoorEvent, Exception, Visit } from "@visitproof/domain"

import type { VisitRepository } from "./repo"

export interface DbVisitRepositoryOptions {
  /** The single agency the MCP demo serves (matches the demo seed). */
  readonly agencyId: string
  /** Client the voice user is asking about; defaults to the first on the roster. */
  readonly defaultClientId?: string
}

const isoDate = (value: string) => value.slice(0, 10)

/**
 * Read-side `VisitRepository` backed by the real `@visitproof/db`
 * repository (local JSON store in demo, DynamoDB in production), so the MCP
 * tools answer from the same seeded data as the console.
 */
export const createDbVisitRepository = (
  store: VisitProofRepository,
  options: DbVisitRepositoryOptions,
): VisitRepository => {
  const { agencyId } = options

  const findVisit = async (visitId: string): Promise<Visit | null> => {
    for (const client of await store.clients.byAgency(agencyId)) {
      const visit = await store.visits.get(client.id, visitId)
      if (visit) return visit
    }
    return null
  }

  return {
    async getDefaultClient(): Promise<Client | null> {
      const clients = await store.clients.byAgency(agencyId)
      if (options.defaultClientId) {
        const preferred = clients.find((client) => client.id === options.defaultClientId)
        if (preferred) return preferred
      }
      return clients[0] ?? null
    },

    getClient(clientId: string): Promise<Client | null> {
      return store.clients.get(agencyId, clientId)
    },

    getCaregiver(caregiverId: string): Promise<Caregiver | null> {
      return store.caregivers.get(agencyId, caregiverId)
    },

    getVisit: findVisit,

    async listVisitsByDate(date: string, clientId?: string): Promise<Visit[]> {
      const visits = await store.visits.byAgencyAndDate(agencyId, date)
      return clientId ? visits.filter((visit) => visit.clientId === clientId) : visits
    },

    async listExceptions(date?: string, state?: Exception["state"]): Promise<Exception[]> {
      const exceptions = await store.exceptions.byAgency(agencyId, state)
      return date
        ? exceptions.filter((exception) => isoDate(exception.openedAt) === date)
        : exceptions
    },

    async listDoorEvents(visitId: string): Promise<DoorEvent[]> {
      const visit = await findVisit(visitId)
      if (!visit) return []
      const events = await store.events.byClient(visit.clientId)
      const start = Date.parse(visit.scheduledStart) - 30 * 60 * 1000
      const end = Date.parse(visit.scheduledEnd) + 30 * 60 * 1000
      return events
        .filter((event) => {
          const at = Date.parse(event.at)
          return at >= start && at <= end
        })
        .sort((a, b) => a.timestampMs - b.timestampMs)
    },
  }
}
