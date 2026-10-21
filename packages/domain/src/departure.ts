/**
 * Departure detection (EARS rules 6 and 7; docs/solution.md Section 6.2
 * rule 3). The departure is the last human event after the arrival that is
 * followed by the quiet period. It stays provisional and moves later as more
 * in-window human events arrive. A departure at or after
 * end - earlyDepartureMin is recorded as soon as the door goes quiet (later
 * events can only keep it on time); an earlier one is judged early only once
 * the visit window closes at end + 60 min, because the caregiver may still
 * be inside.
 */
import { isArrivalSignal } from "./arrival"
import { DEFAULT_TOLERANCES, type DoorEvent, type Tolerances, type Visit, type VisitBoundary } from "./types"
import { visitWindow } from "./window"

const MIN = 60_000

export type DepartureEvaluation =
  | { state: "departed"; departure: VisitBoundary; early: boolean }
  | { state: "pending"; provisional?: VisitBoundary }
  | { state: "not_observed" }

export interface DepartureInput {
  visit: Visit
  /** Events assigned to this visit (its own window). */
  events: readonly DoorEvent[]
  /** Unmatched human events after the window, to detect activity continuing past end + 60 min. */
  afterWindow?: readonly DoorEvent[]
  tolerances: Tolerances
  now: Date
}

const byTime = (a: DoorEvent, b: DoorEvent): number =>
  Date.parse(a.at) - Date.parse(b.at) || a.requestId.localeCompare(b.requestId)

function boundaryOf(event: DoorEvent): VisitBoundary {
  return { at: event.at, eventId: event.requestId, source: "rule" }
}

/** Evaluate the departure for a visit with an arrival at `now`. */
export function evaluateDeparture(input: DepartureInput): DepartureEvaluation {
  const { visit, tolerances } = input
  if (!visit.arrival) return { state: "pending" }
  const nowMs = input.now.getTime()
  const arrivalMs = Date.parse(visit.arrival.at)
  const window = visitWindow(visit)
  const quietMs = tolerances.departureQuietMin * MIN
  const signals = input.events
    .filter((event) => isArrivalSignal(event))
    .filter((event) => {
      const at = Date.parse(event.at)
      return at > arrivalMs && at <= window.to && at <= nowMs
    })
    .sort(byTime)
  const last = signals.at(-1)
  if (!last) return nowMs > window.to ? { state: "not_observed" } : { state: "pending" }
  const lastMs = Date.parse(last.at)
  if (continuesPastWindow(lastMs, input.afterWindow ?? [], window.to, quietMs, nowMs)) {
    return { state: "not_observed" }
  }
  const provisional = boundaryOf(last)
  if (nowMs - lastMs < quietMs) return { state: "pending", provisional }
  const cutoff = window.end - tolerances.earlyDepartureMin * MIN
  if (lastMs >= cutoff) return { state: "departed", departure: provisional, early: false }
  if (nowMs >= window.to) return { state: "departed", departure: provisional, early: true }
  return { state: "pending", provisional }
}

/** EARS 7: a human event past end + 60 min with no quiet period before it. */
function continuesPastWindow(
  lastMs: number,
  afterWindow: readonly DoorEvent[],
  windowTo: number,
  quietMs: number,
  nowMs: number
): boolean {
  return afterWindow.some((event) => {
    if (!isArrivalSignal(event)) return false
    const at = Date.parse(event.at)
    return at > windowTo && at <= nowMs && at - lastMs < quietMs
  })
}

export type DepartureResult = VisitBoundary | "not_observed"

/**
 * Compatibility wrapper over {@link evaluateDeparture}: the recorded
 * departure, or "not_observed" while it is pending or unobservable. Events
 * are limited to this visit's own window.
 */
export function detectDeparture(
  visit: Visit,
  events: readonly DoorEvent[],
  quietMin: number,
  now: Date,
  tolerances: Tolerances = DEFAULT_TOLERANCES
): DepartureResult {
  const window = visitWindow(visit)
  const own = events.filter((event) => {
    const at = Date.parse(event.at)
    return at >= window.from && at <= window.to
  })
  const afterWindow = events.filter((event) => Date.parse(event.at) > window.to)
  const result = evaluateDeparture({
    visit,
    events: own,
    afterWindow,
    tolerances: { ...tolerances, departureQuietMin: quietMin },
    now,
  })
  return result.state === "departed" ? result.departure : "not_observed"
}
