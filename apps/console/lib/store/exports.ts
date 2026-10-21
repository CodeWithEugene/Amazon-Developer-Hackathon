import "server-only"

import { buildEvidencePack, toOpenEvvVisit } from "@visitproof/domain"

import { renderEvidencePack } from "@/lib/pdf/evidence-pack"

import { getAgency } from "./agency"
import { agencyCanSee } from "./consent"
import { ConsentError, notFound } from "./errors"
import { LOCAL_SIGNER_KEY_ID, verifyLedgerRecords } from "./ledger"
import { AGENCY_ID, getStore } from "./repository"

/**
 * Evidence Pack PDF for one client: every visit with its three columns,
 * every signed ledger record, the pack hash, and the signer key id.
 * Refused (403) when the family has withdrawn sharing (contract C3).
 */
export async function buildEvidencePackPdf(clientId: string): Promise<Uint8Array> {
  const store = getStore()
  const agency = await getAgency()
  const client = (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  if (!agencyCanSee(client)) {
    throw new ConsentError("The family has withdrawn sharing for this client.")
  }
  const [visits, events, evvRecords, allExceptions, ledger, caregivers] =
    await Promise.all([
      store.visits.byClient(clientId),
      store.events.byClient(clientId),
      store.evvRecords.byClient(clientId),
      store.exceptions.byAgency(AGENCY_ID),
      store.evidence.ledgerByClient(clientId),
      store.caregivers.byAgency(AGENCY_ID),
    ])
  const exceptions = allExceptions.filter((e) => e.clientId === clientId)
  const notes = (
    await Promise.all(visits.map((visit) => store.evidence.notesByVisit(visit.id)))
  ).flat()
  const pack = buildEvidencePack({
    client,
    visits,
    events,
    evvRecords,
    exceptions,
    tolerances: agency.tolerances,
    now: new Date(),
  })
  return renderEvidencePack({
    agencyName: agency.name,
    timeZone: agency.timezone,
    client,
    caregiverNames: Object.fromEntries(caregivers.map((c) => [c.id, c.name])),
    pack,
    visits,
    events,
    evvRecords,
    exceptions,
    notes,
    ledger,
    chainVerified: verifyLedgerRecords(ledger),
    signerKeyId: LOCAL_SIGNER_KEY_ID,
  })
}

/** Alternate EVV JSON for every client whose family shares with the agency. */
export async function toOpenEvvExport(): Promise<string> {
  const store = getStore()
  const agency = await getAgency()
  const clients = (await store.clients.byAgency(AGENCY_ID)).filter(agencyCanSee)
  const groups = await Promise.all(
    clients.map(async (client) => {
      const [visits, evvRecords] = await Promise.all([
        store.visits.byClient(client.id),
        store.evvRecords.byClient(client.id),
      ])
      return visits.map((visit) =>
        toOpenEvvVisit(
          visit,
          evvRecords.find((record) => record.visitId === visit.id)
        )
      )
    })
  )
  return JSON.stringify(
    {
      agency: agency.name,
      agencyId: AGENCY_ID,
      exportedAt: new Date().toISOString(),
      visits: groups.flat(),
    },
    null,
    2
  )
}
