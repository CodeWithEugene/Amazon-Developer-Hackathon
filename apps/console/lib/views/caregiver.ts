import "server-only"

import type { Note, ReconciliationOutcome, Visit } from "@visitproof/domain"

import { formatTime, formatWindow } from "@/lib/format"
import { AUTHOR_ROLE_LABELS, NOTE_CLASSIFICATION_LABELS } from "@/lib/labels"
import {
  getAgency,
  getSessionCaregiverId,
  listCaregivers,
  listClients,
  listNotes,
  listRecentVisits,
} from "@/lib/store"
import { isMissingClockInWithDoor } from "@/lib/store/persona"
import {
  formatDateKeyWeekday,
  formatLocalDateTime,
  localDateKey,
  zoneAbbreviation,
} from "@/lib/time"

export interface CaregiverVisit {
  id: string
  clientName: string
  dateLabel: string
  window: string
  doorArrival: string
  doorDeparture: string
  clockIn: string
  status: Visit["status"]
  outcome: ReconciliationOutcome
  missingClockInWithDoor: boolean
}

export interface CaregiverDay {
  dayKey: string
  dateLabel: string
  visits: CaregiverVisit[]
}

export interface NoteRow {
  id: string
  title: string
  text: string
  meta: string
}

export interface CaregiverData {
  caregiverName: string
  days: CaregiverDay[]
  selected: CaregiverVisit | null
  notes: NoteRow[]
}

const HISTORY_DAYS = 14

function caregiverVisit(visit: Visit, clientName: string, tz: string): CaregiverVisit {
  return {
    id: visit.id,
    clientName,
    dateLabel: formatDateKeyWeekday(localDateKey(visit.scheduledStart, tz)),
    window: formatWindow(visit.scheduledStart, visit.scheduledEnd, tz),
    doorArrival: formatTime(visit.arrival?.at, tz),
    doorDeparture: formatTime(visit.departure?.at, tz),
    clockIn: visit.reconciliation?.clockIn ? formatTime(visit.reconciliation.clockIn, tz) : "none",
    status: visit.status,
    outcome: visit.reconciliation?.outcome ?? "pending",
    missingClockInWithDoor: isMissingClockInWithDoor(visit),
  }
}

const noteRow = (note: Note, tz: string): NoteRow => ({
  id: note.id,
  title: NOTE_CLASSIFICATION_LABELS[note.classification ?? "fyi"],
  text: note.text,
  meta: `Added ${formatLocalDateTime(note.at, tz)} ${zoneAbbreviation(note.at, tz)} by ${AUTHOR_ROLE_LABELS[note.authorRole]}`,
})

function groupByDay(visits: readonly CaregiverVisit[], keys: readonly string[]): CaregiverDay[] {
  const days: CaregiverDay[] = []
  visits.forEach((visit, index) => {
    const key = keys[index] ?? ""
    const last = days.at(-1)
    if (last && last.dayKey === key) {
      days[days.length - 1] = { ...last, visits: [...last.visits, visit] }
    } else {
      days.push({ dayKey: key, dateLabel: visit.dateLabel, visits: [visit] })
    }
  })
  return days
}

/**
 * The caregiver's own visits for the last two weeks, newest first. The
 * selected visit comes from `?visit=`; by default it is the most recent
 * missing clock-in with door presence, so the dispute flow has a purpose.
 */
export async function loadCaregiver(
  selectedId: string | undefined,
  now: Date = new Date()
): Promise<CaregiverData | null> {
  const caregiverId = await getSessionCaregiverId()
  if (!caregiverId) return null
  const [agency, visits, clients, caregivers] = await Promise.all([
    getAgency(),
    listRecentVisits(HISTORY_DAYS, now),
    listClients(),
    listCaregivers(),
  ])
  const tz = agency.timezone
  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const mine = visits
    .filter((v) => v.caregiverId === caregiverId)
    .sort((a, b) => b.scheduledStart.localeCompare(a.scheduledStart))
  const rows = mine.map((v) => caregiverVisit(v, clientName.get(v.clientId) ?? "Client", tz))
  const selected =
    rows.find((r) => r.id === selectedId) ??
    rows.find((r) => r.missingClockInWithDoor) ??
    rows[0] ??
    null
  const notes = selected ? await listNotes(selected.id) : []
  return {
    caregiverName: caregivers.find((c) => c.id === caregiverId)?.name ?? "Caregiver",
    days: groupByDay(rows, mine.map((v) => localDateKey(v.scheduledStart, tz))),
    selected,
    notes: notes.map((n) => noteRow(n, tz)),
  }
}
