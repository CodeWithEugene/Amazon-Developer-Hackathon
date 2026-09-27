/**
 * Evidence packs, Alternate EVV JSON, and ledger signing
 * (docs/build.md Sections 4 and 6). Pure: hashing via node:crypto,
 * signatures via an injected signer (KMS ECDSA in production).
 */
import { createHash } from "node:crypto"

import type {
  Client,
  DoorEvent,
  EVVRecord,
  Exception,
  LedgerColumn,
  LedgerRecord,
  Tolerances,
  Visit,
} from "./types"
import { reconcile } from "./engine"

export type { LedgerColumn }

export interface EvidenceTimelineEntry {
  at: string
  column: "observed" | "reported" | "resolved"
  label: string
}

export interface EvidenceVisitSummary {
  visitId: string
  date: string
  scheduledStart: string
  scheduledEnd: string
  status: Visit["status"]
  arrival?: Visit["arrival"]
  departure?: Visit["departure"]
  reconciliation?: Visit["reconciliation"]
  narrative?: string
  exceptionKinds: string[]
}

export interface EvidencePack {
  clientId: string
  clientName: string
  agencyId: string
  generatedAt: string
  rangeStart: string
  rangeEnd: string
  visits: EvidenceVisitSummary[]
  timeline: EvidenceTimelineEntry[]
  payloadHash: string
}

export interface EvidencePackInput {
  client: Client
  visits: readonly Visit[]
  events: readonly DoorEvent[]
  evvRecords: readonly EVVRecord[]
  exceptions: readonly Exception[]
  tolerances: Tolerances
  now: Date
}

export function buildEvidencePack(input: EvidencePackInput): EvidencePack {
  const { client, now, tolerances } = input
  const range = input.visits.map((visit) => Date.parse(visit.scheduledStart))
  const rangeStart = range.length > 0 ? new Date(Math.min(...range)).toISOString() : now.toISOString()
  const rangeEnd = range.length > 0 ? new Date(Math.max(...input.visits.map((v) => Date.parse(v.scheduledEnd)))).toISOString() : now.toISOString()

  const visits: EvidenceVisitSummary[] = input.visits.map((visit) => {
    const computed = reconcile({ visit, evvRecords: input.evvRecords, tolerances })
    return {
      visitId: visit.id,
      date: visit.date,
      scheduledStart: visit.scheduledStart,
      scheduledEnd: visit.scheduledEnd,
      status: visit.status,
      arrival: visit.arrival,
      departure: visit.departure,
      reconciliation:
        visit.reconciliation ??
        (computed.outcome === "pending" ? undefined : computed),
      narrative: visit.narrative?.text,
      exceptionKinds: input.exceptions
        .filter((exception) => exception.visitId === visit.id)
        .map((exception) => exception.kind),
    }
  })

  const timeline: EvidenceTimelineEntry[] = buildTimeline(input)

  const pack: Omit<EvidencePack, "payloadHash"> = {
    clientId: client.id,
    clientName: client.name,
    agencyId: client.agencyId,
    generatedAt: now.toISOString(),
    rangeStart,
    rangeEnd,
    visits,
    timeline,
  }
  return { ...pack, payloadHash: canonicalHash(pack) }
}

function buildTimeline(input: EvidencePackInput): EvidenceTimelineEntry[] {
  const entries: EvidenceTimelineEntry[] = []
  for (const event of input.events) {
    entries.push({
      at: event.at,
      column: "observed",
      label: `${event.type}${event.subType ? ` (${event.subType})` : ""} via ${event.provenance}`,
    })
  }
  for (const evv of input.evvRecords) {
    entries.push({ at: evv.clockIn, column: "reported", label: `clock-in (${evv.source})` })
    if (evv.clockOut) {
      entries.push({ at: evv.clockOut, column: "reported", label: `clock-out (${evv.source})` })
    }
  }
  for (const exception of input.exceptions) {
    entries.push({ at: exception.openedAt, column: "resolved", label: `exception ${exception.kind} opened` })
    if (exception.resolution) {
      entries.push({
        at: exception.resolution.at,
        column: "resolved",
        label: `exception ${exception.kind} resolved: ${exception.resolution.reason}`,
      })
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}

// ---------------------------------------------------------------------------
// Alternate EVV JSON export
// ---------------------------------------------------------------------------

export interface OpenEvvVisitJson {
  VisitGUID: string
  EVVWorkerID?: string
  ServiceCode: string
  StartDateTime: string
  EndDateTime?: string
  ClientID: string
  ProviderID?: string
  ExceptionIndicator?: string
}

/** Alternate EVV JSON: door-observed times when available, else EVV, else schedule. */
export function toOpenEvvVisit(visit: Visit, evv?: EVVRecord): OpenEvvVisitJson {
  return {
    VisitGUID: visit.id,
    EVVWorkerID: evv?.caregiverEvvId,
    ServiceCode: evv?.serviceCode ?? visit.serviceCode,
    StartDateTime: visit.arrival?.at ?? evv?.clockIn ?? visit.scheduledStart,
    EndDateTime: visit.departure?.at ?? evv?.clockOut,
    ClientID: visit.clientId,
    ExceptionIndicator: evv ? undefined : "MISSING_CLOCK_IN",
  }
}

// ---------------------------------------------------------------------------
// Ledger signing
// ---------------------------------------------------------------------------

export type LedgerSigner = (payloadHash: string) => string

export interface SignLedgerInput {
  clientId: string
  seq: number
  column: LedgerColumn
  subject: string
  payload: unknown
  signerKeyId: string
  at: string
  prev?: LedgerRecord
  sign: LedgerSigner
}

/**
 * The digest the signer actually signs: the full record context
 * (client, sequence, column, subject, payload, and chain link), so a
 * signature cannot be lifted onto a different record that happens to carry
 * the same payload hash. Verifiers recompute this over a stored record and
 * compare against `signature`.
 */
export function ledgerSigningHash(
  record: Pick<
    LedgerRecord,
    "clientId" | "seq" | "column" | "subject" | "payloadHash" | "prevHash"
  >
): string {
  return canonicalHash({
    clientId: record.clientId,
    seq: record.seq,
    column: record.column,
    subject: record.subject,
    payloadHash: record.payloadHash,
    prevHash: record.prevHash,
  })
}

/** Append a signed, hash-chained ledger record (EARS rule 10). */
export function signLedger(input: SignLedgerInput): LedgerRecord {
  const payloadHash = canonicalHash(input.payload)
  const prevHash = input.prev ? canonicalHash(input.prev) : "genesis"
  const context = {
    clientId: input.clientId,
    seq: input.seq,
    column: input.column,
    subject: input.subject,
    payloadHash,
    prevHash,
  }
  return {
    ...context,
    signature: input.sign(ledgerSigningHash(context)),
    signerKeyId: input.signerKeyId,
    at: input.at,
  }
}

export function verifyChain(records: readonly LedgerRecord[], verify: (record: LedgerRecord) => boolean): boolean {
  let prev: LedgerRecord | undefined
  for (const record of [...records].sort((a, b) => a.seq - b.seq)) {
    const expectedPrevHash = prev ? canonicalHash(prev) : "genesis"
    if (record.prevHash !== expectedPrevHash) return false
    if (!verify(record)) return false
    prev = record
  }
  return true
}

/** Deterministic canonical JSON: sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}
