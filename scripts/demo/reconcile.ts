/**
 * Reconciliation after the EVV import (EARS rule 9), then narratives.
 * Every visit is reconciled against the imported clock records and its own
 * door events; the matched record is stamped with the visit id. Narratives
 * are written afterwards by the engine's narrative writer, so they carry
 * the reconciliation sentence and agency-local times (contract C1).
 */
import type { VisitProofRepository } from "@visitproof/db"
import {
  DEFAULT_TOLERANCES,
  reconcile,
  type EVVRecord,
  type Reconciliation,
  type Visit,
} from "@visitproof/domain"
import {
  createNarrativeWriter,
  repositoryEngineDeps,
  type Clock,
} from "@visitproof/engine"

import { AGENCY_ID } from "./config"
import { DemoError } from "./log"

async function allVisits(repo: VisitProofRepository): Promise<Visit[]> {
  const clients = await repo.clients.byAgency(AGENCY_ID)
  return (
    await Promise.all(clients.map((client) => repo.visits.byClient(client.id)))
  ).flat()
}

async function reconcileClient(
  repo: VisitProofRepository,
  clientId: string,
  visits: readonly Visit[],
  at: string
): Promise<Reconciliation[]> {
  const events = await repo.events.byClient(clientId)
  const records = await repo.evvRecords.byClient(clientId)
  const stamped = new Map<string, string>()
  const outcomes: Reconciliation[] = []
  for (const visit of visits) {
    // The 10 and 30 minute bands are spec constants; tolerances are kept for the signature.
    const reconciliation = reconcile({
      visit,
      evvRecords: records,
      tolerances: DEFAULT_TOLERANCES,
      events,
    })
    outcomes.push(reconciliation)
    await repo.visits.put({
      ...visit,
      reconciliation,
      updatedAt: at,
      version: visit.version + 1,
    })
    const matched = records.find(
      (record) => record.id === reconciliation.evvRecordId
    )
    if (matched) await stampRecord(repo, matched, visit.id, at, stamped)
  }
  return outcomes
}

async function stampRecord(
  repo: VisitProofRepository,
  record: EVVRecord,
  visitId: string,
  at: string,
  stamped: Map<string, string>
): Promise<void> {
  const previous = stamped.get(record.id) ?? record.visitId
  if (previous === visitId) return
  if (previous !== undefined) {
    throw new DemoError(
      `EVV record ${record.id} matched both ${previous} and ${visitId}`
    )
  }
  stamped.set(record.id, visitId)
  await repo.evvRecords.put({
    ...record,
    visitId,
    updatedAt: at,
    version: record.version + 1,
  })
}

/** Reconciles every visit; returns the outcomes. */
export async function reconcileAll(
  repo: VisitProofRepository,
  at: Date
): Promise<Reconciliation[]> {
  const visits = await allVisits(repo)
  const clientIds = [...new Set(visits.map((visit) => visit.clientId))]
  const outcomes: Reconciliation[] = []
  for (const clientId of clientIds) {
    const clientVisits = visits.filter((visit) => visit.clientId === clientId)
    outcomes.push(
      ...(await reconcileClient(repo, clientId, clientVisits, at.toISOString()))
    )
  }
  return outcomes
}

/** Runs the engine's narrative writer over the reconciled visits. */
export async function writeNarratives(
  repo: VisitProofRepository,
  clock: Clock
): Promise<number> {
  await createNarrativeWriter(
    repositoryEngineDeps(repo, AGENCY_ID, { clock })
  )()
  return (await allVisits(repo)).filter(
    (visit) => visit.narrative !== undefined
  ).length
}
