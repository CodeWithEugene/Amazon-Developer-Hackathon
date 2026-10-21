/**
 * Reconciliation of the EVV clock record against the door record (EARS rule
 * 9; docs/solution.md Section 6.2 rule 5). Only door-sourced boundaries
 * corroborate: a manual (agency-entered) time is never door evidence
 * (shared contract C2).
 */
import type {
  DoorEvent,
  EventProvenance,
  EVVRecord,
  Reconciliation,
  Tolerances,
  Visit,
  VisitBoundary,
} from "./types"

const MIN = 60_000

export interface ReconcileInput {
  visit: Visit
  evvRecords: readonly EVVRecord[]
  /**
   * Retained for call-site compatibility; the 10/30 minute bands are spec
   * constants (docs/solution.md Section 6.2 rule 5), not agency tolerances.
   */
  tolerances: Tolerances
  /**
   * The client's door events. When given, a boundary counts as door
   * evidence only if its source event exists with a door provenance.
   */
  events?: readonly DoorEvent[]
}

/** Provenances that come from the door itself (shared contract C4). */
export const DOOR_PROVENANCES: ReadonlySet<EventProvenance> = new Set([
  "ring_webhook",
  "ring_history",
  "playground",
  "emulated",
])

/**
 * Reconciliation bands (docs/solution.md Section 6.2 rule 5): both deltas
 * within 10 minutes is corroborated; any delta beyond 30 minutes is
 * contradicted. A delta in the 10 to 30 minute band is recorded with its
 * variance visible (`corroborated_with_variance`) instead of being folded
 * into either extreme. These are spec constants, not agency tolerances.
 */
export const RECONCILE_CORROBORATED_WITHIN_MIN = 10
export const RECONCILE_CONTRADICTED_BEYOND_MIN = 30

type DeltaBand = "within" | "variance" | "beyond"

function deltaBand(absDeltaMin: number): DeltaBand {
  if (absDeltaMin <= RECONCILE_CORROBORATED_WITHIN_MIN) return "within"
  if (absDeltaMin > RECONCILE_CONTRADICTED_BEYOND_MIN) return "beyond"
  return "variance"
}

function matchEvv(visit: Visit, records: readonly EVVRecord[]): EVVRecord | undefined {
  const byId = records.find((record) => record.visitId === visit.id)
  if (byId) return byId
  const start = Date.parse(visit.scheduledStart)
  const end = Date.parse(visit.scheduledEnd)
  return records.find(
    (record) =>
      record.clientId === visit.clientId &&
      Date.parse(record.clockIn) >= start - 60 * MIN &&
      Date.parse(record.clockIn) <= end + 60 * MIN
  )
}

/** A boundary the door observed (rule or Jev over a door event), never a manual entry. */
export function isDoorBoundary(
  boundary: VisitBoundary | undefined,
  events?: readonly DoorEvent[]
): boundary is VisitBoundary {
  if (!boundary || boundary.source === "manual") return false
  if (!events || !boundary.eventId) return true
  const source = events.find((event) => event.requestId === boundary.eventId)
  return source !== undefined && DOOR_PROVENANCES.has(source.provenance)
}

function roundTo(value: number): number {
  return Math.round(value * 100) / 100
}

/** Classify the EVV clock record against the door record (EARS rule 9). */
export function reconcile(input: ReconcileInput): Reconciliation {
  const { visit } = input
  if (visit.observability.state === "unobservable") return { outcome: "unobservable" }
  const doorArrival = isDoorBoundary(visit.arrival, input.events) ? visit.arrival : undefined
  const attested = visit.arrival !== undefined && doorArrival === undefined
  const evv = matchEvv(visit, input.evvRecords)
  if (!evv) {
    return { outcome: doorArrival ? "missing_clock_in" : "missing_both" }
  }
  const evvFields = { evvRecordId: evv.id, clockIn: evv.clockIn, clockOut: evv.clockOut }
  if (!doorArrival) {
    // A clock-in with no door presence contradicts the door; one the agency
    // attested by hand is recorded as missing door evidence instead.
    return { outcome: attested ? "missing_door" : "contradicted", ...evvFields }
  }
  const deltaArrivalMin = (Date.parse(evv.clockIn) - Date.parse(doorArrival.at)) / MIN
  const doorDeparture = isDoorBoundary(visit.departure, input.events) ? visit.departure : undefined
  const deltaDepartureMin =
    evv.clockOut && doorDeparture
      ? (Date.parse(evv.clockOut) - Date.parse(doorDeparture.at)) / MIN
      : undefined
  const bands: DeltaBand[] = [
    deltaBand(Math.abs(deltaArrivalMin)),
    ...(deltaDepartureMin === undefined ? [] : [deltaBand(Math.abs(deltaDepartureMin))]),
  ]
  const outcome: Reconciliation["outcome"] = bands.includes("beyond")
    ? "contradicted"
    : bands.includes("variance")
      ? "corroborated_with_variance"
      : "corroborated"
  return {
    outcome,
    ...evvFields,
    deltaArrivalMin: roundTo(deltaArrivalMin),
    deltaDepartureMin: deltaDepartureMin === undefined ? undefined : roundTo(deltaDepartureMin),
  }
}
