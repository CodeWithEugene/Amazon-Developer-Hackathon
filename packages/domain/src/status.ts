/**
 * Visit status machine helpers (docs/build.md Section 6): scheduled to
 * awaiting_arrival to arrived_on_time | arrived_late | no_show, then
 * in_progress to completed | early_departure | departure_not_observed, with
 * the unobservable overlay and ambiguous routing to a human.
 */
import type { Tolerances, Visit, VisitStatus } from "./types"

const MIN = 60_000

const TERMINAL: ReadonlySet<VisitStatus> = new Set([
  "completed",
  "early_departure",
  "departure_not_observed",
  "no_show",
])

export function isTerminalStatus(status: VisitStatus): boolean {
  return TERMINAL.has(status)
}

export function shiftIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MIN).toISOString()
}

/** Time-based status from schedule, arrival, and departure (no events needed). */
export function classifyVisit(visit: Visit, now: Date, tolerances: Tolerances): VisitStatus {
  if (visit.observability.state === "unobservable") return "unobservable"
  const start = Date.parse(visit.scheduledStart)
  const end = Date.parse(visit.scheduledEnd)
  const nowMs = now.getTime()
  if (!visit.arrival) {
    if (nowMs < start - 30 * MIN) return "scheduled"
    if (nowMs < start + tolerances.escalationMin * MIN) return "awaiting_arrival"
    return "no_show"
  }
  if (visit.departure) {
    const earlyCutoff = Date.parse(shiftIso(visit.scheduledEnd, -tolerances.earlyDepartureMin))
    return Date.parse(visit.departure.at) < earlyCutoff ? "early_departure" : "completed"
  }
  if (nowMs > end + 60 * MIN) return "departure_not_observed"
  return "in_progress"
}
