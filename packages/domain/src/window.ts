/**
 * Visit windows and event assignment (EARS rule 1). A visit is observable
 * from start - 60 min to end + 60 min. When two visits for the same client
 * have overlapping windows, each event goes to the nearest visit, so one
 * visit never consumes another visit's arrival or departure.
 */
import type { DoorEvent, Visit } from "./types"

const MIN = 60_000

/** Minutes before the scheduled start and after the scheduled end a visit observes. */
export const WINDOW_PADDING_MIN = 60

export interface VisitWindow {
  start: number
  end: number
  from: number
  to: number
}

export function visitWindow(visit: Pick<Visit, "scheduledStart" | "scheduledEnd">): VisitWindow {
  const start = Date.parse(visit.scheduledStart)
  const end = Math.max(start, Date.parse(visit.scheduledEnd))
  return {
    start,
    end,
    from: start - WINDOW_PADDING_MIN * MIN,
    to: end + WINDOW_PADDING_MIN * MIN,
  }
}

interface Distance {
  outside: number
  edge: number
}

/** Distance from an instant to the scheduled interval, then to its nearest edge. */
function distanceTo(at: number, window: VisitWindow): Distance {
  const outside = at < window.start ? window.start - at : at > window.end ? at - window.end : 0
  const edge = Math.min(Math.abs(at - window.start), Math.abs(at - window.end))
  return { outside, edge }
}

function compareCandidates(at: number, a: Visit, b: Visit): number {
  const da = distanceTo(at, visitWindow(a))
  const db = distanceTo(at, visitWindow(b))
  return (
    da.outside - db.outside ||
    da.edge - db.edge ||
    Date.parse(a.scheduledStart) - Date.parse(b.scheduledStart) ||
    a.id.localeCompare(b.id)
  )
}

/**
 * The visit an event belongs to: among the client's visits whose window
 * contains the event, the one whose scheduled interval is nearest (then the
 * one with the nearest start or end, then the earliest), or null.
 */
export function assignVisit(event: Pick<DoorEvent, "clientId" | "at">, visits: readonly Visit[]): Visit | null {
  const at = Date.parse(event.at)
  const containing = visits.filter((visit) => {
    if (visit.clientId !== event.clientId) return false
    const window = visitWindow(visit)
    return at >= window.from && at <= window.to
  })
  if (containing.length === 0) return null
  return [...containing].sort((a, b) => compareCandidates(at, a, b))[0] ?? null
}

/** Find the visit whose window [start - 60 min, end + 60 min] contains the event. */
export function findVisitWindow(
  client: { id: string },
  event: DoorEvent,
  visits: readonly Visit[]
): Visit | null {
  return assignVisit({ clientId: client.id, at: event.at }, visits)
}

/** Group events by the visit they are assigned to (unmatched events are dropped). */
export function assignEvents(
  events: readonly DoorEvent[],
  visits: readonly Visit[]
): ReadonlyMap<string, readonly DoorEvent[]> {
  const grouped = new Map<string, DoorEvent[]>()
  for (const event of events) {
    const visit = assignVisit(event, visits)
    if (!visit) continue
    grouped.set(visit.id, [...(grouped.get(visit.id) ?? []), event])
  }
  return grouped
}

/** The events assigned to `visit` given every visit for its client. */
export function eventsForVisit(
  visit: Visit,
  events: readonly DoorEvent[],
  clientVisits: readonly Visit[]
): readonly DoorEvent[] {
  const visits = clientVisits.some((candidate) => candidate.id === visit.id)
    ? clientVisits
    : [...clientVisits, visit]
  return events.filter((event) => assignVisit(event, visits)?.id === visit.id)
}
