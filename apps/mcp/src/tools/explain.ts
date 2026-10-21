import type { DoorEvent, Note, Visit } from "@visitproof/domain"

import type { AgencySettings } from "../repo"
import { clockOf, detailsHidden, resolveClient, ToolError, type ToolContext } from "./context"
import { spokenTime, spokenWindow, statusLabel } from "./format"

export interface EvidenceEntry {
  column: "observed" | "reported" | "resolved"
  at: string
  time: string
  text: string
  provenance?: DoorEvent["provenance"]
}

export interface SignedRecordSummary {
  seq: number
  column: "observed" | "reported" | "resolved"
  subject: string
  signerKeyId: string
  signature: string
}

export interface VisitEvidenceResult {
  spoken: string
  visitId?: string
  window?: string
  status?: Visit["status"]
  timeline?: EvidenceEntry[]
  signedRecords?: SignedRecordSummary[]
  summary?: string
}

const PROVENANCE_LABELS: Record<DoorEvent["provenance"], string> = {
  ring_webhook: "Ring webhook",
  ring_history: "Ring history",
  playground: "Ring Playground sandbox device",
  emulated: "Emulated event (demo)",
}

const eventText = (event: DoorEvent): string => {
  const kind = event.type === "ding" ? "Doorbell press" : event.type === "motion" ? `Motion${event.subType === "human" ? " (person)" : ""}` : event.type.replace(/_/g, " ")
  return `${kind} from the door, via ${PROVENANCE_LABELS[event.provenance]}.`
}

const NOTE_AUTHORS: Record<Note["authorRole"], string> = {
  agency_admin: "Agency",
  agency_staff: "Agency",
  family: "Family",
  caregiver: "Caregiver",
  system: "System",
}

const entry = (column: EvidenceEntry["column"], at: string, text: string, tz: string, provenance?: DoorEvent["provenance"]): EvidenceEntry => ({
  column,
  at,
  time: spokenTime(at, tz),
  text,
  ...(provenance ? { provenance } : {}),
})

const buildTimeline = async (context: ToolContext, visit: Visit, settings: AgencySettings): Promise<EvidenceEntry[]> => {
  const tz = settings.timeZone
  const [events, notes, exceptions] = await Promise.all([
    context.repo.listDoorEvents(visit.id),
    context.repo.listNotes(visit.id),
    context.repo.listExceptions(),
  ])
  const rows: EvidenceEntry[] = events.map((event) => entry("observed", event.at, eventText(event), tz, event.provenance))
  if (visit.arrival) rows.push(entry("observed", visit.arrival.at, `Arrival derived from the door record at ${spokenTime(visit.arrival.at, tz)}.`, tz))
  if (visit.departure) rows.push(entry("observed", visit.departure.at, `Departure derived from the door record at ${spokenTime(visit.departure.at, tz)}.`, tz))
  const { clockIn, clockOut } = visit.reconciliation ?? {}
  if (clockIn) rows.push(entry("reported", clockIn, `Caregiver clock-in at ${spokenTime(clockIn, tz)}.`, tz))
  if (clockOut) rows.push(entry("reported", clockOut, `Caregiver clock-out at ${spokenTime(clockOut, tz)}.`, tz))
  for (const note of notes) rows.push(entry("reported", note.at, `${NOTE_AUTHORS[note.authorRole]} note: ${note.text}`, tz))
  for (const exception of exceptions.filter((candidate) => candidate.visitId === visit.id)) {
    const kind = exception.kind.replace(/_/g, " ")
    rows.push(entry("resolved", exception.openedAt, `Exception opened: ${kind}.`, tz))
    if (exception.resolution) {
      rows.push(entry("resolved", exception.resolution.at, `Exception resolved (${kind}): ${exception.resolution.reason.replace(/_/g, " ")}.`, tz))
    }
  }
  return rows.sort((a, b) => a.at.localeCompare(b.at))
}

const signedRecordsFor = async (context: ToolContext, visit: Visit, notes: readonly string[]): Promise<SignedRecordSummary[]> => {
  const subjects = new Set([visit.id, `evv_${visit.id}`, ...notes])
  const ledger = await context.repo.listLedger(visit.clientId)
  return ledger
    .filter((record) => subjects.has(record.subject) || record.subject.startsWith(`${visit.id}#`))
    .map((record) => ({ seq: record.seq, column: record.column, subject: record.subject, signerKeyId: record.signerKeyId, signature: record.signature }))
}

const countIn = (rows: readonly EvidenceEntry[], column: EvidenceEntry["column"]) => rows.filter((row) => row.column === column).length

/** explain_visit: the three-column evidence timeline in plain language. */
export async function explainVisit(args: { visitId: string }, context: ToolContext): Promise<VisitEvidenceResult> {
  const visit = await context.repo.getVisit(args.visitId)
  if (!visit) throw new ToolError("I could not find that visit.", "not_found")
  const client = await resolveClient(context, visit.clientId)
  if (detailsHidden(context, client)) {
    return { spoken: "The family has turned off sharing with the agency, so this visit's details are hidden.", visitId: visit.id }
  }
  const { settings } = await clockOf(context)
  const tz = settings.timeZone
  const timeline = await buildTimeline(context, visit, settings)
  const noteIds = (await context.repo.listNotes(visit.id)).map((note) => note.id)
  const signedRecords = await signedRecordsFor(context, visit, noteIds)
  const window = spokenWindow(visit.scheduledStart, visit.scheduledEnd, tz)
  const observed = visit.arrival
    ? `the door saw someone arrive at ${spokenTime(visit.arrival.at, tz)}${visit.departure ? ` and leave at ${spokenTime(visit.departure.at, tz)}` : ""}`
    : "the door saw no arrival"
  const spoken = `The visit scheduled ${window} is ${statusLabel(visit.status)}. Observed: ${observed}. Reported: ${countIn(timeline, "reported")} entries. Resolved: ${countIn(timeline, "resolved")} entries. ${signedRecords.length} signed ledger records.`
  return {
    spoken,
    visitId: visit.id,
    window,
    status: visit.status,
    timeline,
    signedRecords,
    ...(visit.narrative ? { summary: visit.narrative.text } : {}),
  }
}
