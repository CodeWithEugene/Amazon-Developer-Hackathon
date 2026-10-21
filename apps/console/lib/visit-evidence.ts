import type {
  DoorEvent,
  EVVRecord,
  EvvSource,
  Exception,
  Note,
  Visit,
} from "@visitproof/domain"

/**
 * Pure helpers that split a visit's evidence into the three columns
 * (Observed, Reported, Resolved) that are shown side by side and never
 * merged (docs/solution.md Section 4, principle 3).
 */

/** Door events this far outside the window still belong to the visit. */
const WINDOW_MARGIN_MS = 60 * 60_000

const PRESENCE_TYPES: readonly DoorEvent["type"][] = ["motion", "ding", "on_demand"]

export const EVV_SOURCE_LABELS: Record<EvvSource, string> = {
  csv: "EVV Vendor Import",
  manual: "Manual Entry",
  caregiver_link: "Caregiver Link",
}

/** Door events around the visit window, oldest first. */
export function eventsForVisit(
  visit: Visit,
  events: readonly DoorEvent[]
): DoorEvent[] {
  const start = Date.parse(visit.scheduledStart) - WINDOW_MARGIN_MS
  const end = Date.parse(visit.scheduledEnd) + WINDOW_MARGIN_MS
  const boundaryIds = new Set(
    [visit.arrival?.eventId, visit.departure?.eventId].filter(Boolean)
  )
  return events
    .filter((event) => PRESENCE_TYPES.includes(event.type) || boundaryIds.has(event.requestId))
    .filter((event) => {
      const at = Date.parse(event.at)
      return at >= start && at <= end
    })
    .sort((a, b) => a.timestampMs - b.timestampMs)
}

/** The EVV record reconciled with the visit, if any. */
export function evvForVisit(
  visit: Visit,
  records: readonly EVVRecord[]
): EVVRecord | undefined {
  const byId = visit.reconciliation?.evvRecordId
  return (
    records.find((record) => record.visitId === visit.id) ??
    (byId ? records.find((record) => record.id === byId) : undefined)
  )
}

const AGENCY_AUTHORS: readonly Note["authorRole"][] = [
  "agency_admin",
  "agency_staff",
  "system",
]

/** Reported: what the caregiver or family said. Resolved: agency notes. */
export function splitNotes(notes: readonly Note[]): {
  reported: Note[]
  resolved: Note[]
} {
  const byTime = [...notes].sort((a, b) => a.at.localeCompare(b.at))
  return {
    reported: byTime.filter((note) => !AGENCY_AUTHORS.includes(note.authorRole)),
    resolved: byTime.filter((note) => AGENCY_AUTHORS.includes(note.authorRole)),
  }
}

export const exceptionsForVisit = (
  visit: Visit,
  exceptions: readonly Exception[]
): Exception[] =>
  exceptions
    .filter((exception) => exception.visitId === visit.id)
    .sort((a, b) => a.openedAt.localeCompare(b.openedAt))

/** Whether an event is the one the engine chose as arrival or departure. */
export function boundaryRole(
  visit: Visit,
  event: DoorEvent
): "arrival" | "departure" | null {
  const ids = [event.requestId, event.rawPayloadHash]
  if (visit.arrival?.eventId && ids.includes(visit.arrival.eventId)) return "arrival"
  if (visit.departure?.eventId && ids.includes(visit.departure.eventId)) return "departure"
  return null
}
