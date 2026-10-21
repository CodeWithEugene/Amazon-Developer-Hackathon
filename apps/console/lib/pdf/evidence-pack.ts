import type {
  Client,
  DoorEvent,
  EVVRecord,
  EvidencePack,
  Exception,
  LedgerRecord,
  Note,
  Visit,
} from "@visitproof/domain"
import { statusLabel } from "@workspace/ui/components/status-badge"

import {
  BOUNDARY_SOURCE_LABELS,
  HONEST_BOUNDARIES,
  NOTE_CLASSIFICATION_LABELS,
  PROVENANCE_LABELS,
  reasonLabel,
} from "@/lib/labels"
import { displayNarrative } from "@/lib/narrative"
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  formatLocalTimeZoned,
  zoneAbbreviation,
} from "@/lib/time"
import {
  EVV_SOURCE_LABELS,
  eventsForVisit,
  evvForVisit,
  exceptionsForVisit,
  splitNotes,
} from "@/lib/visit-evidence"

import { renderPdf, type PdfLine } from "./writer"

export interface EvidencePackDocument {
  agencyName: string
  timeZone: string
  client: Client
  caregiverNames: Readonly<Record<string, string>>
  pack: EvidencePack
  visits: readonly Visit[]
  events: readonly DoorEvent[]
  evvRecords: readonly EVVRecord[]
  exceptions: readonly Exception[]
  notes: readonly Note[]
  ledger: readonly LedgerRecord[]
  chainVerified: boolean
  signerKeyId: string
}

const heading = (text: string): PdfLine => ({
  text,
  font: "bold",
  size: 13,
  gapBefore: 12,
})

function observedLine(visit: Visit, events: readonly DoorEvent[], tz: string): string {
  const boundary = (label: string, b: Visit["arrival"]): string =>
    b
      ? `${label} ${formatLocalTimeZoned(b.at, tz)} (${BOUNDARY_SOURCE_LABELS[b.source]})`
      : `${label} not observed`
  const provenance = [...new Set(events.map((e) => PROVENANCE_LABELS[e.provenance]))]
  const eventText =
    events.length === 0
      ? "No door events in the window."
      : `${events.length} door events, source: ${provenance.join(", ")}.`
  const observability =
    visit.observability.state === "observable"
      ? ""
      : ` Observability: ${statusLabel(visit.observability.state)} (${visit.observability.reasons.map(statusLabel).join(", ") || "no reason recorded"}).`
  return `Observed (door): ${boundary("arrival", visit.arrival)}, ${boundary("departure", visit.departure)}. ${eventText}${observability}`
}

function reportedLine(evv: EVVRecord | undefined, notes: readonly Note[], tz: string): string {
  const clock = evv
    ? `clock-in ${formatLocalTimeZoned(evv.clockIn, tz)}, clock-out ${evv.clockOut ? formatLocalTimeZoned(evv.clockOut, tz) : "none"} (${EVV_SOURCE_LABELS[evv.source]})`
    : "no EVV clock-in"
  const noteText = notes
    .map((n) => `${NOTE_CLASSIFICATION_LABELS[n.classification ?? "fyi"]}: "${n.text}"`)
    .join(" ")
  return `Reported (caregiver and family): ${clock}.${noteText ? ` ${noteText}` : ""}`
}

function resolvedLine(exceptions: readonly Exception[], notes: readonly Note[]): string {
  const decisions = exceptions.map((e) =>
    e.resolution
      ? `${statusLabel(e.kind)} resolved by ${e.resolution.by}: ${reasonLabel(e.resolution.reason)}`
      : `${statusLabel(e.kind)} ${statusLabel(e.state)}`
  )
  const corrections = notes.map((n) => n.text)
  const all = [...decisions, ...corrections]
  return `Resolved (agency): ${all.length > 0 ? all.join(". ") : "no agency decisions"}.`
}

function visitLines(doc: EvidencePackDocument, visit: Visit): PdfLine[] {
  const tz = doc.timeZone
  const events = eventsForVisit(visit, doc.events)
  const notes = splitNotes(doc.notes.filter((n) => n.visitId === visit.id))
  const narrative = displayNarrative(visit, tz)
  const outcome = visit.reconciliation?.outcome ?? "pending"
  const caregiver = doc.caregiverNames[visit.caregiverId] ?? "Unassigned"
  const lines: PdfLine[] = [
    {
      text: `${formatLocalDate(visit.scheduledStart, tz)}, ${formatLocalTime(visit.scheduledStart, tz)} to ${formatLocalTimeZoned(visit.scheduledEnd, tz)}`,
      font: "bold",
      size: 10.5,
      gapBefore: 8,
    },
    {
      text: `Visit ${visit.id}. Scheduled caregiver: ${caregiver}. Service ${visit.serviceCode}. Status: ${statusLabel(visit.status)}. Reconciliation: ${statusLabel(outcome)}.`,
      indent: 10,
      size: 9,
    },
    { text: observedLine(visit, events, tz), indent: 10, size: 9 },
    { text: reportedLine(evvForVisit(visit, doc.evvRecords), notes.reported, tz), indent: 10, size: 9 },
    { text: resolvedLine(exceptionsForVisit(visit, doc.exceptions), notes.resolved), indent: 10, size: 9 },
  ]
  return narrative
    ? [...lines, { text: `Narrative (${narrative.provenance}): ${narrative.text}`, indent: 10, size: 9 }]
    : lines
}

function ledgerLines(doc: EvidencePackDocument): PdfLine[] {
  return doc.ledger.flatMap((record): PdfLine[] => [
    {
      text: `Seq ${record.seq} | ${statusLabel(record.column)} | ${formatLocalDateTime(record.at, doc.timeZone)} ${zoneAbbreviation(record.at, doc.timeZone)} | subject ${record.subject}`,
      size: 8.5,
      gapBefore: 3,
    },
    { text: `payload   ${record.payloadHash}`, font: "mono", size: 7.5, indent: 10 },
    { text: `prev      ${record.prevHash}`, font: "mono", size: 7.5, indent: 10 },
    { text: `signature ${record.signature}`, font: "mono", size: 7.5, indent: 10 },
  ])
}

/** The full pack as PDF lines, in reading order. */
export function evidencePackLines(doc: EvidencePackDocument): PdfLine[] {
  const tz = doc.timeZone
  const visits = [...doc.visits].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  return [
    { text: "VisitProof Evidence Pack", font: "bold", size: 18 },
    { text: `Agency: ${doc.agencyName}`, gapBefore: 8 },
    { text: `Client: ${doc.client.name} (${doc.client.homeLabel})` },
    { text: `Range: ${formatLocalDate(doc.pack.rangeStart, tz)} to ${formatLocalDate(doc.pack.rangeEnd, tz)}` },
    { text: `Generated: ${formatLocalDate(doc.pack.generatedAt, tz)}, ${formatLocalTimeZoned(doc.pack.generatedAt, tz)}` },
    { text: `Visits: ${visits.length}. Signed ledger records: ${doc.ledger.length}. Times are shown in ${tz}.` },
    { text: `Pack hash: ${doc.pack.payloadHash}`, font: "mono", size: 8, gapBefore: 4 },
    { text: HONEST_BOUNDARIES, size: 9, gapBefore: 6 },
    {
      text: "Each visit lists three separate columns: Observed (door events), Reported (EVV clock-in and notes), and Resolved (agency decisions). None overwrites another.",
      size: 9,
    },
    heading("Visits"),
    ...visits.flatMap((visit) => visitLines(doc, visit)),
    heading("Signed Ledger Records"),
    ...ledgerLines(doc),
    heading("Verification"),
    { text: "Pack Hash", font: "bold", size: 10, gapBefore: 4 },
    { text: doc.pack.payloadHash, font: "mono", size: 8.5 },
    { text: `Signer key id: ${doc.signerKeyId} (local HMAC stand-in for the KMS ECDSA P-256 key)`, size: 9, gapBefore: 4 },
    { text: `Hash chain and signatures verified: ${doc.chainVerified ? "Yes" : "No, the chain did not verify"}`, size: 9 },
  ]
}

export function renderEvidencePack(doc: EvidencePackDocument): Uint8Array {
  const shortHash = doc.pack.payloadHash.slice(0, 12)
  return renderPdf(
    evidencePackLines(doc),
    (page, total) =>
      `VisitProof Evidence Pack | ${doc.client.name} | pack ${shortHash} | Page ${page} of ${total}`
  )
}
