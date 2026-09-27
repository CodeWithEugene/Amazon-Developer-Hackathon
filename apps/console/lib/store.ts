import "server-only"

import { createHmac } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  createLocalRepository,
  newId,
  type VisitProofRepository,
} from "@visitproof/db"
import {
  buildEvidencePack,
  classifyVisit,
  ledgerSigningHash,
  reconcile,
  signLedger,
  toOpenEvvVisit,
  verifyChain,
  type Agency,
  type Caregiver,
  type Client,
  type Consent,
  type EVVRecord,
  type Exception,
  type ExceptionResolution,
  type LedgerRecord,
  type Note,
  type Visit,
} from "@visitproof/domain"

/**
 * Console data access, backed by the real `@visitproof/db`
 * `VisitProofRepository`. The offline demo runs on `createLocalRepository`
 * pointed at the seeded demo store (see scripts/demo.ts); production swaps in
 * `createDynamoRepository` with the same call sites. The agency record itself
 * lives outside the single-table model, so the demo seeds it as
 * `agency.json` inside the store directory.
 */

export const AGENCY_ID = "a1"

/** Local stand-in for the KMS ECDSA signer; demo mode only. */
const LOCAL_SIGNER = {
  keyId: "local-demo/ledger-signing-key",
  secret: "visitproof-local-demo-ledger",
}

export interface BackfillInput {
  arrivalAt?: string
  departureAt?: string
  reason?: string
}

export interface NoteInput {
  visitId: string
  authorRole: Note["authorRole"]
  authorId: string
  text: string
  classification?: Note["classification"]
}

export interface ConsentPatch {
  shareWithAgency?: boolean
  snapshotsEnabled?: boolean
  snapshotRetentionDays?: number
  exceptionAlerts?: boolean
}

const storeDir = (): string =>
  process.env.VISITPROOF_DEMO_STORE_PATH ?? join(process.cwd(), ".demo-data")

/** A fresh repository per call so requests never see a stale table cache. */
export const getStore = (): VisitProofRepository =>
  createLocalRepository(storeDir())

const FALLBACK_AGENCY: Agency = {
  id: AGENCY_ID,
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: "America/New_York",
  tolerances: {
    graceMin: 15,
    escalationMin: 45,
    earlyDepartureMin: 10,
    departureQuietMin: 10,
  },
  retentionDays: 365,
  evvVendor: "State EVV Portal",
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  version: 1,
}

export async function getAgency(): Promise<Agency> {
  try {
    const raw = await readFile(join(storeDir(), "agency.json"), "utf8")
    return { ...FALLBACK_AGENCY, ...(JSON.parse(raw) as Partial<Agency>) }
  } catch {
    return FALLBACK_AGENCY
  }
}

export const listClients = (): Promise<Client[]> =>
  getStore().clients.byAgency(AGENCY_ID)

export const listCaregivers = (): Promise<Caregiver[]> =>
  getStore().caregivers.byAgency(AGENCY_ID)

/**
 * Demo persona bindings. The mock sign-in sets only a role cookie, so each
 * family or caregiver session is bound to a fixed persona on the roster:
 * the family sees the first client, the caregiver sees the caregiver with
 * the most visits on record. API routes must scope writes to these ids.
 */
export async function getSessionClientId(): Promise<string | undefined> {
  return (await listClients())[0]?.id
}

export async function getSessionCaregiverId(): Promise<string | undefined> {
  const [visits, caregivers] = await Promise.all([
    listVisits(),
    listCaregivers(),
  ])
  const visitCountByCaregiver = new Map<string, number>()
  for (const visit of visits) {
    visitCountByCaregiver.set(
      visit.caregiverId,
      (visitCountByCaregiver.get(visit.caregiverId) ?? 0) + 1
    )
  }
  return (
    [...visitCountByCaregiver.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    caregivers[0]?.id
  )
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10)

export const listVisits = (date?: string): Promise<Visit[]> =>
  getStore().visits.byAgencyAndDate(AGENCY_ID, date ?? todayUtc())

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
 * Re-verifies the hash chain and every signature against the local demo
 * signer, recomputing the domain's signing digest over each stored record.
 * Production swaps the HMAC stand-in for the KMS ECDSA P-256 key.
 */
export const verifyLedgerRecords = (
  records: readonly LedgerRecord[]
): boolean =>
  verifyChain(
    records,
    (record) =>
      createHmac("sha256", LOCAL_SIGNER.secret)
        .update(ledgerSigningHash(record))
        .digest("hex") === record.signature
  )

const notFound = (what: string): never => {
  throw new Error(`${what} not found`)
}

async function appendLedger(
  store: VisitProofRepository,
  clientId: string,
  column: LedgerRecord["column"],
  subject: string,
  payload: unknown
): Promise<void> {
  const existing = await store.evidence.ledgerByClient(clientId)
  const prev = existing.at(-1)
  const record = signLedger({
    clientId,
    seq: (prev?.seq ?? 0) + 1,
    column,
    subject,
    payload,
    signerKeyId: LOCAL_SIGNER.keyId,
    at: new Date().toISOString(),
    ...(prev ? { prev } : {}),
    sign: (hash) =>
      createHmac("sha256", LOCAL_SIGNER.secret).update(hash).digest("hex"),
  })
  await store.evidence.appendLedger(record)
}

export async function backfillVisit(
  visitId: string,
  input: BackfillInput,
  actor: string
): Promise<Visit> {
  const store = getStore()
  const found = (await getVisit(visitId)) ?? notFound("Visit")
  const now = new Date()
  const nowIso = now.toISOString()
  let visit: Visit = { ...found, updatedAt: nowIso, version: found.version + 1 }
  if (input.arrivalAt) {
    visit = { ...visit, arrival: { at: input.arrivalAt, source: "manual" } }
  }
  if (input.departureAt) {
    visit = { ...visit, departure: { at: input.departureAt, source: "manual" } }
  }
  const agency = await getAgency()
  const status = classifyVisit(visit, now, agency.tolerances)
  visit = {
    ...visit,
    status:
      status === "scheduled" || status === "awaiting_arrival"
        ? Date.parse(visit.arrival?.at ?? "") >
          Date.parse(visit.scheduledStart) + agency.tolerances.graceMin * 60_000
          ? "arrived_late"
          : "arrived_on_time"
        : status,
    reconciliation: reconcile({
      visit,
      evvRecords: await store.evvRecords.byClient(visit.clientId),
      tolerances: agency.tolerances,
    }),
  }
  await store.visits.put(visit)

  const open = (await store.exceptions.byAgency(AGENCY_ID)).filter(
    (e) => e.visitId === visitId && e.state !== "resolved"
  )
  for (const exception of open) {
    await store.exceptions.put({
      ...exception,
      state: "resolved",
      resolution: {
        by: actor,
        at: nowIso,
        reason: input.reason ?? "backfilled",
        note: "Times backfilled from caregiver confirmation.",
      },
      updatedAt: nowIso,
      version: exception.version + 1,
    })
  }
  await appendLedger(store, visit.clientId, "resolved", visitId, {
    arrivalAt: input.arrivalAt ?? null,
    departureAt: input.departureAt ?? null,
  })
  return visit
}

export async function resolveException(
  exceptionId: string,
  resolution: Omit<ExceptionResolution, "at">
): Promise<Exception> {
  const store = getStore()
  const exception =
    (await store.exceptions.get(AGENCY_ID, exceptionId)) ??
    notFound("Exception")
  const nowIso = new Date().toISOString()
  const updated: Exception = {
    ...exception,
    state: "resolved",
    resolution: { ...resolution, at: nowIso },
    updatedAt: nowIso,
    version: exception.version + 1,
  }
  await store.exceptions.put(updated)
  await appendLedger(store, exception.clientId, "resolved", exceptionId, {
    reason: resolution.reason,
  })
  return updated
}

export async function snoozeException(
  exceptionId: string,
  minutes: number
): Promise<Exception> {
  const store = getStore()
  const exception =
    (await store.exceptions.get(AGENCY_ID, exceptionId)) ??
    notFound("Exception")
  const updated: Exception = {
    ...exception,
    state: "snoozed",
    snoozeUntil: new Date(Date.now() + minutes * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    version: exception.version + 1,
  }
  await store.exceptions.put(updated)
  return updated
}

export async function addNote(input: NoteInput): Promise<Note> {
  const store = getStore()
  const nowIso = new Date().toISOString()
  const note: Note = {
    id: newId(),
    visitId: input.visitId,
    authorRole: input.authorRole,
    authorId: input.authorId,
    at: nowIso,
    text: input.text,
    ...(input.classification ? { classification: input.classification } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  }
  await store.evidence.putNote(note)
  const visit = await getVisit(input.visitId)
  if (visit) {
    await appendLedger(store, visit.clientId, "reported", note.id, note.text)
  }
  return note
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
    await Promise.all(
      visits.map((visit) => store.evidence.notesByVisit(visit.id))
    )
  ).flat()
  const payload = {
    client,
    visits,
    notes,
    evvRecords: await store.evvRecords.byClient(clientId),
    ledger: await store.evidence.ledgerByClient(clientId),
    exportedAt: new Date().toISOString(),
  }
  return JSON.stringify(payload, null, 2)
}

/**
 * Delete is a tombstone in demo mode: the link is removed and consent is
 * withdrawn, which stops all further sharing. Physical row deletion is a
 * DynamoDB TTL and erasure job in production (docs/compliance.md).
 */
export async function deleteClientData(clientId: string): Promise<void> {
  const store = getStore()
  const client =
    (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  await store.clients.put({
    ...client,
    ringLinkStatus: "removed",
    consent: {
      ...client.consent,
      shareWithAgency: false,
      snapshotsEnabled: false,
    },
    updatedAt: new Date().toISOString(),
    version: client.version + 1,
  })
}

export async function buildEvidencePackPdf(
  clientId: string
): Promise<Uint8Array> {
  const store = getStore()
  const agency = await getAgency()
  const client =
    (await store.clients.get(AGENCY_ID, clientId)) ?? notFound("Client")
  const [visits, events, evvRecords, exceptions, ledger] = await Promise.all([
    store.visits.byClient(clientId),
    store.events.byClient(clientId),
    store.evvRecords.byClient(clientId),
    store.exceptions
      .byAgency(AGENCY_ID)
      .then((list) => list.filter((e) => e.clientId === clientId)),
    store.evidence.ledgerByClient(clientId),
  ])
  const pack = buildEvidencePack({
    client,
    visits,
    events,
    evvRecords,
    exceptions,
    tolerances: agency.tolerances,
    now: new Date(),
  })
  const lines = [
    "VisitProof Evidence Pack",
    "",
    `Agency: ${agency.name}`,
    `Client: ${client.name} (${client.homeLabel})`,
    `Range: ${pack.rangeStart.slice(0, 10)} to ${pack.rangeEnd.slice(0, 10)}`,
    `Generated: ${pack.generatedAt}`,
    "",
    "Visits",
    ...pack.visits.flatMap((v) => [
      `${v.date} ${v.scheduledStart.slice(11, 16)} to ${v.scheduledEnd.slice(11, 16)} UTC`,
      `  Status: ${v.status}`,
      `  Arrival: ${v.arrival?.at.slice(11, 16) ?? "not observed"}`,
      `  Departure: ${v.departure?.at.slice(11, 16) ?? "not observed"}`,
      `  Reconciliation: ${v.reconciliation?.outcome ?? "pending"}`,
      `  Exceptions: ${v.exceptionKinds.join(", ") || "none"}`,
    ]),
    "",
    "Signed Ledger Records",
    ...ledger.map(
      (l) =>
        `Seq ${l.seq} [${l.column}] subject ${l.subject} hash ${l.payloadHash.slice(0, 12)}`
    ),
    "",
    `Pack hash: ${pack.payloadHash}`,
    `Ledger signer: ${LOCAL_SIGNER.keyId} (local demo stand-in for KMS ECDSA P-256)`,
  ]
  return buildPdf(lines)
}

export async function toOpenEvvExport(): Promise<string> {
  const store = getStore()
  const agency = await getAgency()
  const clients = await store.clients.byAgency(AGENCY_ID)
  const rows = []
  for (const client of clients) {
    const [visits, evvRecords] = await Promise.all([
      store.visits.byClient(client.id),
      store.evvRecords.byClient(client.id),
    ])
    for (const visit of visits) {
      const evv = evvRecords.find((record) => record.visitId === visit.id)
      rows.push(toOpenEvvVisit(visit, evv))
    }
  }
  return JSON.stringify(
    {
      agency: agency.name,
      agencyId: AGENCY_ID,
      exportedAt: new Date().toISOString(),
      visits: rows,
    },
    null,
    2
  )
}

/** Minimal single-page PDF with Helvetica text lines. */
function buildPdf(lines: string[]): Uint8Array {
  const esc = (s: string): string =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  let text = "BT /F1 11 Tf 14 TL 40 780 Td\n"
  for (const line of lines.slice(0, 52)) {
    text += `(${esc(line)}) Tj T*\n`
  }
  text += "ET"
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  let pdf = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return new TextEncoder().encode(pdf)
}
