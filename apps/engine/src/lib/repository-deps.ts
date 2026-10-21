/**
 * Engine ports over a `VisitProofRepository` (DynamoDB in production, the
 * local JSON store in the demo) for one agency. Ports this wiring does not
 * cover (narrator, mail, snapshots, evidence) come from `overrides` or the
 * in-memory defaults.
 */
import type { VisitProofRepository } from "@visitproof/db"
import type { Exception, Visit } from "@visitproof/domain"

import {
  consoleMailTransport,
  InMemoryEvidenceStore,
  NoopSnapshotService,
} from "./defaults"
import type { EngineDeps, SnapshotRecordStore } from "./ports"

const TERMINAL_STATUSES: ReadonlySet<Visit["status"]> = new Set([
  "completed",
  "early_departure",
  "departure_not_observed",
])

export function repositoryEngineDeps(
  repository: VisitProofRepository,
  agencyId: string,
  overrides: Partial<EngineDeps> = {}
): EngineDeps {
  const listAll = async (): Promise<Visit[]> => {
    const clients = await repository.clients.byAgency(agencyId)
    const groups = await Promise.all(
      clients.map((client) => repository.visits.byClient(client.id))
    )
    return groups.flat()
  }

  return {
    clock: { now: () => new Date() },
    visits: {
      listForClient: (clientId) => repository.visits.byClient(clientId),
      listActive: async () =>
        (await listAll()).filter((v) => !TERMINAL_STATUSES.has(v.status)),
      listAll,
      save: (visit) => repository.visits.put(visit),
    },
    clients: {
      get: async (clientId) =>
        (await repository.clients.get(agencyId, clientId)) ?? undefined,
      list: () => repository.clients.byAgency(agencyId),
    },
    events: {
      append: (event) => repository.events.put(event),
      listForClient: (clientId) => repository.events.byClient(clientId),
    },
    exceptions: {
      listOpen: () => repository.exceptions.byAgency(agencyId, "open"),
      listForClient: async (clientId) =>
        (await repository.exceptions.byAgency(agencyId)).filter(
          (e) => e.clientId === clientId
        ),
      open: (exception) => repository.exceptions.put(exception),
      resolve: async (id, resolution) => {
        const exception: Exception | null = await repository.exceptions.get(
          agencyId,
          id
        )
        // Only the system may close its own cards, and only while open.
        if (exception === null || exception.state !== "open") return
        await repository.exceptions.put({
          ...exception,
          state: "resolved",
          resolution,
          updatedAt: resolution.at,
          version: exception.version + 1,
        })
      },
    },
    evv: {
      listForClient: (clientId) => repository.evvRecords.byClient(clientId),
    },
    narratives: {
      save: async (visitId, narrative) => {
        const visit = (await listAll()).find(
          (candidate) => candidate.id === visitId
        )
        if (visit === undefined) throw new Error(`unknown visit ${visitId}`)
        await repository.visits.put({
          ...visit,
          narrative,
          updatedAt: narrative.generatedAt,
          version: visit.version + 1,
        })
      },
    },
    agencies: {
      get: async (id) => (await repository.agencies?.get(id)) ?? undefined,
    },
    snapshots: new NoopSnapshotService(),
    evidence: new InMemoryEvidenceStore(),
    mail: consoleMailTransport,
    ...overrides,
  }
}

/** Snapshot rows through the repository's evidence section. */
export const repositorySnapshotRecords = (
  repository: VisitProofRepository
): SnapshotRecordStore => ({
  put: (snapshot) => repository.evidence.putSnapshot(snapshot),
  listForVisit: (visitId) => repository.evidence.snapshotsByVisit(visitId),
})
