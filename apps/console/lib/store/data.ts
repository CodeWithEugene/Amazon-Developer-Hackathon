import "server-only"

import type { Client, Consent } from "@visitproof/domain"

import { notFound } from "./errors"
import { appendLedger } from "./ledger"
import { AGENCY_ID, getStore } from "./repository"

export interface ConsentPatch {
  shareWithAgency?: boolean
  snapshotsEnabled?: boolean
  snapshotRetentionDays?: number
  exceptionAlerts?: boolean
}

export interface DeletionSummary {
  events: number
  notes: number
  snapshots: number
  /** False when the repository cannot physically delete that kind yet. */
  physicalDeletion: boolean
}

export async function updateConsent(
  clientId: string,
  patch: ConsentPatch
): Promise<Client> {
  const store = getStore()
  const client =
    (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  const merged: Consent = { ...client.consent, ...patch }
  return store.clients.saveConsent(AGENCY_ID, clientId, merged, new Date())
}

export async function exportClientData(clientId: string): Promise<string> {
  const store = getStore()
  const client =
    (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  const visits = await store.visits.byClient(clientId)
  const notes = (
    await Promise.all(visits.map((visit) => store.evidence.notesByVisit(visit.id)))
  ).flat()
  const payload = {
    client,
    visits,
    notes,
    events: await store.events.byClient(clientId),
    evvRecords: await store.evvRecords.byClient(clientId),
    ledger: await store.evidence.ledgerByClient(clientId),
    exportedAt: new Date().toISOString(),
  }
  return JSON.stringify(payload, null, 2)
}

async function eraseEvidence(clientId: string): Promise<DeletionSummary> {
  const store = getStore()
  const visits = await store.visits.byClient(clientId)
  const deleteEvents = store.events.deleteByClient?.bind(store.events)
  const deleteByVisit = store.evidence.deleteByVisit?.bind(store.evidence)
  const events = deleteEvents ? await deleteEvents(clientId) : 0
  let notes = 0
  let snapshots = 0
  if (deleteByVisit) {
    for (const visit of visits) {
      const removed = await deleteByVisit(visit.id)
      notes += removed.notes
      snapshots += removed.snapshots
    }
  }
  return {
    events,
    notes,
    snapshots,
    physicalDeletion: !!deleteEvents && !!deleteByVisit,
  }
}

/**
 * Delete Everything (contract C3): the link is marked removed and sharing
 * withdrawn first, so nothing new is processed; then the client's door
 * events, snapshots, and notes are deleted; then a signed "resolved" ledger
 * record describes the deletion with counts only, no personal data. The
 * ledger itself is append-only and is kept.
 */
export async function deleteClientData(
  clientId: string
): Promise<DeletionSummary> {
  const store = getStore()
  const client =
    (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  const nowIso = new Date().toISOString()
  await store.clients.put({
    ...client,
    ringLinkStatus: "removed",
    consent: { ...client.consent, shareWithAgency: false, snapshotsEnabled: false },
    updatedAt: nowIso,
    version: client.version + 1,
  })
  const summary = await eraseEvidence(clientId)
  await appendLedger(store, clientId, "resolved", "data-deletion", {
    action: "delete_everything",
    requestedBy: "family",
    at: nowIso,
    deleted: {
      events: summary.events,
      notes: summary.notes,
      snapshots: summary.snapshots,
    },
  })
  return summary
}
