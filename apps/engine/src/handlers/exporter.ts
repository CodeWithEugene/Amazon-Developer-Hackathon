/**
 * Exporter. Builds the signed evidence pack (JSON) and the Alternate EVV
 * JSON export for a client and date range. PDF rendering is added in
 * integration week; the JSON evidence pack is the source of truth.
 */
import {
  buildEvidencePack,
  reconcile,
  toOpenEvvVisit,
} from "@visitproof/domain"

import { tolerancesFor } from "../lib/agency"
import type { EngineDeps } from "../lib/ports"

export const handlerName = "exporter"

export interface ExportInput {
  clientId: string
  date: string
}

export function createExporter(deps: EngineDeps) {
  return async function exporter(
    input: ExportInput
  ): Promise<{ evidenceKey: string; evvKey: string }> {
    const client = await deps.clients.get(input.clientId)
    if (!client) throw new Error(`unknown client ${input.clientId}`)
    const allVisits = await deps.visits.listForClient(input.clientId)
    const visits = allVisits.filter((visit) => visit.date === input.date)
    const [events, exceptions, evvRecords] = await Promise.all([
      deps.events.listForClient(input.clientId),
      deps.exceptions.listForClient(input.clientId),
      deps.evv.listForClient(input.clientId),
    ])

    const pack = buildEvidencePack({
      client,
      visits,
      events,
      evvRecords,
      exceptions,
      tolerances: await tolerancesFor(deps, client.agencyId),
      now: deps.clock.now(),
    })
    const evidenceKey = `evidence/${input.clientId}/${input.date}.json`
    await deps.evidence.put(evidenceKey, JSON.stringify(pack, null, 2))

    const evvJson = visits.map((visit) => {
      const matched = evvRecords.find((record) => record.visitId === visit.id)
      return toOpenEvvVisit(visit, matched)
    })
    const evvKey = `evv/${input.clientId}/${input.date}.json`
    await deps.evidence.put(evvKey, JSON.stringify(evvJson, null, 2))
    return { evidenceKey, evvKey }
  }
}

// Re-exported for the reconciliation screen (door vs EVV classification).
export { reconcile }
