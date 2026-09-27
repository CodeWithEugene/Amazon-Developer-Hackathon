import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent, Exception, Visit } from "@visitproof/domain"
import { ingestDoorEvent, type EngineDeps } from "@visitproof/engine"

import type { EngineHandler } from "./index"

const TERMINAL_STATUSES: ReadonlySet<Visit["status"]> = new Set([
  "completed",
  "early_departure",
  "departure_not_observed",
])

/**
 * Wires the receiver to the real Presence Engine. After the event is durably
 * persisted and the receipt claimed, `ingestDoorEvent` applies the pure
 * engine against the same repository the receiver wrote to. Ports the event
 * path never touches (snapshots, narratives, evidence, mail) are inert here;
 * they belong to the sweeper/writer/exporter handlers.
 */
export const createEngineHook = (
  repository: VisitProofRepository,
  agencyId: string
): EngineHandler => {
  const listAllVisits = async (): Promise<Visit[]> => {
    const clients = await repository.clients.byAgency(agencyId)
    const groups = await Promise.all(
      clients.map((client) => repository.visits.byClient(client.id))
    )
    return groups.flat()
  }

  const deps: EngineDeps = {
    clock: { now: () => new Date() },
    visits: {
      listForClient: (clientId) => repository.visits.byClient(clientId),
      listActive: async () =>
        (await listAllVisits()).filter((visit) => !TERMINAL_STATUSES.has(visit.status)),
      listAll: listAllVisits,
      save: (visit) => repository.visits.put(visit),
    },
    clients: {
      get: async (clientId) =>
        (await repository.clients.get(agencyId, clientId)) ?? undefined,
    },
    events: {
      // The receiver already persisted this event; the engine's append is an
      // idempotent upsert on (clientId, timestampMs, requestId).
      append: (event) => repository.events.put(event),
      listForClient: (clientId) => repository.events.byClient(clientId),
    },
    exceptions: {
      listOpen: () => repository.exceptions.byAgency(agencyId, "open"),
      listForClient: async (clientId) =>
        (await repository.exceptions.byAgency(agencyId)).filter(
          (exception) => exception.clientId === clientId
        ),
      open: (exception) => repository.exceptions.put(exception),
      resolve: async (id, resolution) => {
        const exception: Exception | null = await repository.exceptions.get(agencyId, id)
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
    narratives: { save: async () => {} },
    snapshots: { request: async () => {} },
    evidence: { put: async () => {} },
    mail: { send: async () => {} },
  }

  return async (event: DoorEvent | null) => {
    if (event === null) return
    await ingestDoorEvent(deps, event)
  }
}
