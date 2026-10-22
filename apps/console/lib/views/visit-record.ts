import "server-only"

import type { DoorEvent, EVVRecord, Exception, Note, Visit } from "@visitproof/domain"
import { statusLabel } from "@workspace/ui/components/status-badge"

import { formatWindow } from "@/lib/format"
import {
  AUTHOR_ROLE_LABELS,
  BOUNDARY_SOURCE_LABELS,
  doorEventLabel,
  NOTE_CLASSIFICATION_LABELS,
  PROVENANCE_LABELS,
  reasonLabel,
} from "@/lib/labels"
import { displayNarrative, type DisplayNarrative } from "@/lib/narrative"
import type { Role } from "@/lib/roles"
import {
  agencyCanSee,
  getAgency,
  getClient,
  getSessionCaregiverId,
  getSessionClientId,
  getStore,
  getVisit,
  listCaregivers,
  listExceptions,
  listLedgerRecords,
  listNotes,
  verifyLedgerRecords,
} from "@/lib/store"
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTimeZoned,
  zoneAbbreviation,
} from "@/lib/time"
import {
  boundaryRole,
  EVV_SOURCE_LABELS,
  eventsForVisit,
  evvForVisit,
  exceptionsForVisit,
  splitNotes,
} from "@/lib/visit-evidence"

import { familyStatus } from "./family-summary"

export interface RecordEntry {
  id: string
  title: string
  detail: string
  /** Provenance or source label, shown next to every entry. */
  source: string
}

export interface VisitRecordData {
  visitId: string
  clientName: string
  caregiverName: string
  dateLabel: string
  window: string
  status: Visit["status"]
  outcome: string
  narrative: DisplayNarrative | null
  observed: RecordEntry[]
  reported: RecordEntry[]
  resolved: RecordEntry[]
  ledger: { count: number; verified: boolean }
}

export type VisitRecordResult =
  | { kind: "ok"; data: VisitRecordData }
  | { kind: "hidden" }
  | { kind: "missing" }

async function allowed(visit: Visit, viewer: Role): Promise<"ok" | "hidden" | "missing"> {
  if (viewer === "family") {
    return (await getSessionClientId()) === visit.clientId ? "ok" : "missing"
  }
  if (viewer === "caregiver") {
    return (await getSessionCaregiverId()) === visit.caregiverId ? "ok" : "missing"
  }
  const client = await getClient(visit.clientId)
  return client && agencyCanSee(client) ? "ok" : "hidden"
}

function observedEntries(visit: Visit, events: readonly DoorEvent[], tz: string): RecordEntry[] {
  const boundaries: RecordEntry[] = (["arrival", "departure"] as const).map((key) => {
    const boundary = visit[key]
    return {
      id: `boundary-${key}`,
      title: `Observed ${key === "arrival" ? "Arrival" : "Departure"}`,
      detail: boundary ? formatLocalTimeZoned(boundary.at, tz) : "Not observed",
      source: boundary ? BOUNDARY_SOURCE_LABELS[boundary.source] : "Presence Engine",
    }
  })
  const observability: RecordEntry[] =
    visit.observability.state === "observable"
      ? []
      : [
          {
            id: "observability",
            title: statusLabel(visit.observability.state),
            detail: visit.observability.reasons.map(statusLabel).join(", ") || "No reason recorded",
            source: "Presence Engine",
          },
        ]
  const eventEntries = events.map((event) => {
    const role = boundaryRole(visit, event)
    return {
      id: event.requestId,
      title: doorEventLabel(event.type, event.subType),
      detail: `${formatLocalTimeZoned(event.at, tz)}${role ? `, chosen as the ${role}` : ""}`,
      source: PROVENANCE_LABELS[event.provenance],
    }
  })
  return [...boundaries, ...observability, ...eventEntries]
}

const loadEvents = (visit: Visit): Promise<DoorEvent[]> =>
  getStore()
    .events.byClient(visit.clientId)
    .then((events) => eventsForVisit(visit, events))

const AGENCY_AUTHORS: readonly Note["authorRole"][] = ["agency_admin", "agency_staff", "system"]

function noteTitle(note: Note): string {
  if (!AGENCY_AUTHORS.includes(note.authorRole)) {
    return NOTE_CLASSIFICATION_LABELS[note.classification ?? "fyi"]
  }
  return note.text.startsWith("Agency correction") ? "Agency Correction" : "Agency Note"
}

const noteEntry = (note: Note, tz: string): RecordEntry => ({
  id: note.id,
  title: noteTitle(note),
  detail: `${note.text} (${formatLocalDateTime(note.at, tz)} ${zoneAbbreviation(note.at, tz)})`,
  source: AUTHOR_ROLE_LABELS[note.authorRole],
})

function evvEntry(evv: EVVRecord | undefined, tz: string): RecordEntry {
  if (!evv) {
    return { id: "no-evv", title: "EVV Clock-In", detail: "No clock-in recorded", source: "EVV Vendor Import" }
  }
  const out = evv.clockOut ? formatLocalTimeZoned(evv.clockOut, tz) : "not recorded"
  return {
    id: evv.id,
    title: "EVV Clock-In",
    detail: `In ${formatLocalTimeZoned(evv.clockIn, tz)}, out ${out}`,
    source: EVV_SOURCE_LABELS[evv.source],
  }
}

const stamp = (iso: string, tz: string): string =>
  `${formatLocalDateTime(iso, tz)} ${zoneAbbreviation(iso, tz)}`

function exceptionEntry(e: Exception, tz: string): RecordEntry {
  return {
    id: e.id,
    title: `${statusLabel(e.kind)}: ${statusLabel(e.state)}`,
    detail: e.resolution
      ? `Resolved ${stamp(e.resolution.at, tz)} by ${e.resolution.by}. ${reasonLabel(e.resolution.reason)}.`
      : `Opened ${stamp(e.openedAt, tz)}.`,
    source: "Agency Decision",
  }
}

/** The three-column record of one visit, scoped to the viewer's role. */
export async function loadVisitRecord(visitId: string, viewer: Role): Promise<VisitRecordResult> {
  const visit = await getVisit(visitId)
  if (!visit) return { kind: "missing" }
  const access = await allowed(visit, viewer)
  if (access !== "ok") return { kind: access }
  const [agency, client, caregivers, events, evvRecords, exceptions, notes, ledger] =
    await Promise.all([
      getAgency(),
      getClient(visit.clientId),
      listCaregivers(),
      loadEvents(visit),
      getStore().evvRecords.byClient(visit.clientId),
      listExceptions(),
      listNotes(visit.id),
      listLedgerRecords(visit.clientId),
    ])
  const tz = agency.timezone
  const split = splitNotes(notes)
  return {
    kind: "ok",
    data: {
      visitId: visit.id,
      clientName: client?.name ?? "Client",
      caregiverName: caregivers.find((c) => c.id === visit.caregiverId)?.name ?? "Unassigned",
      dateLabel: formatLocalDate(visit.scheduledStart, tz),
      window: formatWindow(visit.scheduledStart, visit.scheduledEnd, tz),
      status: familyStatus(visit, new Date()),
      outcome: visit.reconciliation?.outcome ?? "pending",
      narrative: displayNarrative(visit, tz),
      observed: observedEntries(visit, events, tz),
      reported: [
        evvEntry(evvForVisit(visit, evvRecords), tz),
        ...split.reported.map((n) => noteEntry(n, tz)),
      ],
      resolved: [
        ...exceptionsForVisit(visit, exceptions).map((e) => exceptionEntry(e, tz)),
        ...split.resolved.map((n) => noteEntry(n, tz)),
      ],
      ledger: { count: ledger.length, verified: verifyLedgerRecords(ledger) },
    },
  }
}
