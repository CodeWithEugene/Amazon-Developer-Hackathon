import type { VisitProofRepository } from "@visitproof/db"
import type { Exception, Visit } from "@visitproof/domain"

import type { CopilotDataAccessor, ExceptionFilter, VisitFilter } from "./accessor"

const inDateRange = (iso: string, from?: string, to?: string): boolean => {
  const day = iso.slice(0, 10)
  return (from === undefined || day >= from) && (to === undefined || day <= to)
}

/**
 * `CopilotDataAccessor` backed by the real `@visitproof/db`
 * `VisitProofRepository`: the copilot answers from the same seeded store as
 * the console and the MCP server (local JSON in demo, DynamoDB in
 * production).
 */
export const createDbCopilotAccessor = (
  store: VisitProofRepository,
  agencyId: string,
): CopilotDataAccessor => {
  const allVisits = async (): Promise<Visit[]> => {
    const clients = await store.clients.byAgency(agencyId)
    const groups = await Promise.all(
      clients.map((client) => store.visits.byClient(client.id)),
    )
    return groups.flat()
  }

  const findVisit = async (visitId: string): Promise<Visit | undefined> => {
    for (const client of await store.clients.byAgency(agencyId)) {
      const visit = await store.visits.get(client.id, visitId)
      if (visit) return visit
    }
    return undefined
  }

  return {
    async listVisits(filter: VisitFilter): Promise<readonly Visit[]> {
      return (await allVisits())
        .filter((visit) => inDateRange(visit.date, filter.from, filter.to))
        .filter(
          (visit) =>
            filter.statuses === undefined || filter.statuses.includes(visit.status),
        )
    },

    async listExceptions(filter: ExceptionFilter): Promise<readonly Exception[]> {
      const exceptions = await store.exceptions.byAgency(agencyId, filter.state)
      return exceptions.filter((exception) =>
        inDateRange(exception.openedAt, filter.from, filter.to),
      )
    },

    getVisit: findVisit,

    async getException(exceptionId: string): Promise<Exception | undefined> {
      return (
        (await store.exceptions.get(agencyId, exceptionId)) ?? undefined
      )
    },
  }
}
