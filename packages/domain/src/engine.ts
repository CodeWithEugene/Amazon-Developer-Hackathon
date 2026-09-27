/**
 * Presence Engine orchestrators (docs/build.md Section 6,
 * .kiro/specs/presence-engine): reconciliation, exception raising,
 * event processing, and the visit sweeper. Pure functions with injected
 * time and judgments; the arrival/departure/observability primitives live
 * in ./presence and are re-exported here for a single import surface.
 */
import type {
  DoorEvent,
  EVVRecord,
  Exception,
  ExceptionResolution,
  Reconciliation,
  Tolerances,
  Visit,
  VisitBoundary,
} from "./types"
import {
  arrivalCandidates,
  chooseArrival,
  classifyVisit,
  detectDeparture,
  isTerminalStatus,
  shiftIso,
  type ArrivalJudge,
} from "./presence"

export * from "./presence"

const MIN = 60_000

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  visit: Visit
  evvRecords: readonly EVVRecord[]
  /**
   * Retained for call-site compatibility; the 10/30 minute bands are spec
   * constants (docs/solution.md Section 6.2 rule 5), not agency tolerances.
   */
  tolerances: Tolerances
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

/** Classify EVV clock record against the door record (EARS rule 9). */
export function reconcile(input: ReconcileInput): Reconciliation {
  const { visit } = input
  if (visit.observability.state === "unobservable") {
    return { outcome: "unobservable" }
  }
  const evv = matchEvv(visit, input.evvRecords)
  if (!evv) {
    return {
      outcome: visit.arrival ? "missing_clock_in" : "missing_both",
    }
  }
  if (!visit.arrival) {
    return { outcome: "contradicted", evvRecordId: evv.id, clockIn: evv.clockIn, clockOut: evv.clockOut }
  }
  const deltaArrivalMin =
    (Date.parse(evv.clockIn) - Date.parse(visit.arrival.at)) / MIN
  let deltaDepartureMin: number | undefined
  if (evv.clockOut && visit.departure) {
    deltaDepartureMin =
      (Date.parse(evv.clockOut) - Date.parse(visit.departure.at)) / MIN
  }
  const bands: DeltaBand[] = [deltaBand(Math.abs(deltaArrivalMin))]
  if (deltaDepartureMin !== undefined) {
    bands.push(deltaBand(Math.abs(deltaDepartureMin)))
  }
  const outcome: Reconciliation["outcome"] = bands.includes("beyond")
    ? "contradicted"
    : bands.includes("variance")
      ? "corroborated_with_variance"
      : "corroborated"
  return {
    outcome,
    evvRecordId: evv.id,
    clockIn: evv.clockIn,
    clockOut: evv.clockOut,
    deltaArrivalMin: roundTo(deltaArrivalMin),
    deltaDepartureMin:
      deltaDepartureMin === undefined ? undefined : roundTo(deltaDepartureMin),
  }
}

function roundTo(value: number): number {
  return Math.round(value * 100) / 100
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export interface ExceptionDelta {
  toRaise: Exception[]
  toResolveIds: string[]
}

export function buildException(
  kind: Exception["kind"],
  visit: Visit,
  now: Date,
  idSuffix = ""
): Exception {
  const at = now.toISOString()
  return {
    id: `${visit.id}#${kind}${idSuffix}`,
    agencyId: visit.agencyId,
    visitId: visit.id,
    clientId: visit.clientId,
    kind,
    state: "open",
    openedAt: at,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }
}

/**
 * Exception kinds the system owns end to end: it raises them and it may
 * resolve them when they are superseded (e.g. a `late_no_arrival` card once
 * an arrival is observed or the visit escalates to `no_show`). Every other
 * kind is a human-review card: the engine raises it, but only a person may
 * resolve it — it must survive re-sweeps and event replays untouched.
 */
export const SYSTEM_OWNED_EXCEPTION_KINDS: readonly Exception["kind"][] =
  Object.freeze(["late_no_arrival"])

/**
 * Diff desired exceptions against existing ones; deterministic ids dedupe.
 * Only system-owned kinds (see {@link SYSTEM_OWNED_EXCEPTION_KINDS}) are
 * auto-resolved when they fall out of the desired set — human-review cards
 * stay open until a person resolves them.
 */
export function raiseExceptions(
  previous: readonly Exception[],
  desired: readonly Exception[],
  systemOwnedKinds: readonly Exception["kind"][] = SYSTEM_OWNED_EXCEPTION_KINDS
): ExceptionDelta {
  const previousIds = new Set(previous.map((exception) => exception.id))
  const desiredIds = new Set(desired.map((exception) => exception.id))
  const systemOwned = new Set<Exception["kind"]>(systemOwnedKinds)
  const toRaise = desired.filter((exception) => !previousIds.has(exception.id))
  const toResolveIds = previous
    .filter((exception) => exception.state === "open")
    .filter((exception) => systemOwned.has(exception.kind))
    .filter((exception) => !desiredIds.has(exception.id))
    .map((exception) => exception.id)
  return { toRaise, toResolveIds }
}

export function systemResolution(
  now: Date,
  reason: string
): ExceptionResolution {
  return { by: "system", at: now.toISOString(), reason }
}

// ---------------------------------------------------------------------------
// Event processing (webhook / stream path)
// ---------------------------------------------------------------------------

export interface ProcessEventInput {
  event: DoorEvent
  /** All door events for the client, including `event`. */
  events: readonly DoorEvent[]
  visits: readonly Visit[]
  openExceptions: readonly Exception[]
  tolerances: Tolerances
  now: Date
  judge?: ArrivalJudge
}

export interface ProcessEventResult {
  matched: boolean
  visit?: Visit
  toRaise: Exception[]
  toResolveIds: string[]
}

/** Find the visit whose window [start - 60 min, end + 60 min] contains the event. */
export function findVisitWindow(
  client: { id: string },
  event: DoorEvent,
  visits: readonly Visit[]
): Visit | null {
  const at = Date.parse(event.at)
  for (const visit of visits) {
    if (visit.clientId !== client.id) continue
    const start = Date.parse(visit.scheduledStart)
    const end = Date.parse(visit.scheduledEnd)
    if (at >= start - 60 * MIN && at <= end + 60 * MIN) return visit
  }
  return null
}

/** Apply one door event to the matched visit (EARS rules 1 to 7). */
export function processEvent(input: ProcessEventInput): ProcessEventResult {
  const { event, visits, now, tolerances } = input
  const visit = findVisitWindow({ id: event.clientId }, event, visits)
  if (!visit) return { matched: false, toRaise: [], toResolveIds: [] }
  if (visit.observability.state === "unobservable") {
    return { matched: true, visit, toRaise: [], toResolveIds: [] }
  }
  const previous = input.openExceptions.filter((e) => e.visitId === visit.id)
  let next: Visit = { ...visit }
  const desired: Exception[] = []

  if (!next.arrival) {
    const result = chooseArrival(next, arrivalCandidates(next, input.events), {
      judge: input.judge,
    })
    if (result.outcome === "ambiguous") {
      next = { ...next, status: "ambiguous" }
      desired.push(buildException("ambiguous", visit, now))
    } else if (result.outcome === "chosen") {
      next = { ...next, arrival: result.arrival }
      const graceCutoff = Date.parse(shiftIso(visit.scheduledStart, tolerances.graceMin))
      const late = Date.parse(result.arrival.at) > graceCutoff
      next = { ...next, status: late ? "arrived_late" : "arrived_on_time" }
      if (late) desired.push(buildException("late_arrival", visit, now))
    }
  }

  if (next.arrival && !next.departure) {
    const departure = detectDeparture(next, input.events, tolerances.departureQuietMin, now)
    if (departure !== "not_observed") {
      const withDeparture: Visit = { ...next, departure }
      next = { ...withDeparture, status: classifyVisit(withDeparture, now, tolerances) }
      if (next.status === "early_departure") {
        desired.push(buildException("early_departure", visit, now))
      }
    }
  }

  const delta = raiseExceptions(previous, desired)
  const toResolveIds = [...delta.toResolveIds]
  if (next.arrival) {
    // An observed arrival supersedes the system-owned late_no_arrival card.
    for (const exception of previous) {
      if (
        exception.state === "open" &&
        exception.kind === "late_no_arrival" &&
        !toResolveIds.includes(exception.id)
      ) {
        toResolveIds.push(exception.id)
      }
    }
  }
  return {
    matched: true,
    visit: next,
    toRaise: delta.toRaise,
    toResolveIds,
  }
}

// ---------------------------------------------------------------------------
// Visit sweeper (time-based path)
// ---------------------------------------------------------------------------

export interface SweepVisitsInput {
  visits: readonly Visit[]
  /** All door events for the involved clients. */
  events: readonly DoorEvent[]
  openExceptions: readonly Exception[]
  tolerances: Tolerances
  now: Date
}

export interface SweepVisitsResult {
  visits: Visit[]
  toRaise: Exception[]
  toResolveIds: string[]
}

/** Time-driven transitions: awaiting, late, no-show, departure, unobservable. */
export function sweepVisits(input: SweepVisitsInput): SweepVisitsResult {
  const { now } = input
  const updated: Visit[] = []
  const toRaise: Exception[] = []
  const toResolveIds: string[] = []
  const raisedIds = new Set<string>()

  for (const visit of input.visits) {
    const outcome = sweepVisit(visit, input, now)
    for (const exception of outcome.toRaise) {
      if (!raisedIds.has(exception.id)) {
        raisedIds.add(exception.id)
        toRaise.push(exception)
      }
    }
    toResolveIds.push(...outcome.toResolveIds)
    updated.push(outcome.visit)
  }

  return { visits: updated, toRaise, toResolveIds }
}

function sweepVisit(
  visit: Visit,
  input: SweepVisitsInput,
  now: Date
): { visit: Visit; toRaise: Exception[]; toResolveIds: string[] } {
  const { tolerances } = input
  let next: Visit = { ...visit }
  const previous = input.openExceptions.filter((e) => e.visitId === visit.id)
  const desired: Exception[] = []
  const events = input.events.filter((event) => event.clientId === visit.clientId)

  if (next.observability.state === "unobservable") {
    if (next.status !== "unobservable") next = { ...next, status: "unobservable" }
    desired.push(buildException("unobservable", visit, now))
  } else if (!isTerminalStatus(next.status) || next.status === "no_show") {
    if (
      next.status === "scheduled" &&
      now.getTime() >= Date.parse(next.scheduledStart) - 30 * MIN
    ) {
      next = { ...next, status: "awaiting_arrival" }
    }
    if (!next.arrival) {
      const lateAt = Date.parse(shiftIso(next.scheduledStart, tolerances.graceMin))
      const escalateAt = Date.parse(shiftIso(next.scheduledStart, tolerances.escalationMin))
      if (now.getTime() >= escalateAt) {
        next = { ...next, status: "no_show" }
        desired.push(buildException("no_show", visit, now))
      } else if (now.getTime() >= lateAt) {
        desired.push(buildException("late_no_arrival", visit, now))
      }
    } else if (!next.departure) {
      const departure = detectDeparture(next, events, tolerances.departureQuietMin, now)
      if (departure !== "not_observed") {
        const withDeparture: Visit = { ...next, departure }
        next = { ...withDeparture, status: classifyVisit(withDeparture, now, tolerances) }
        if (next.status === "early_departure") {
          desired.push(buildException("early_departure", visit, now))
        }
      } else {
        const status = classifyVisit(next, now, tolerances)
        if (status === "departure_not_observed") {
          next = { ...next, status }
        } else if (
          status === "in_progress" &&
          // arrived_late is sticky: re-sweeps must not churn a late arrival
          // into a generic in_progress and wash the lateness out of the
          // record (and its exception card) before a human reviews it.
          next.status !== "arrived_late" &&
          now.getTime() >=
            Date.parse((next.arrival as VisitBoundary).at) + tolerances.departureQuietMin * MIN
        ) {
          next = { ...next, status: "in_progress" }
        }
      }
    }
  }

  const delta = raiseExceptions(previous, desired)
  const toResolveIds = [...delta.toResolveIds]
  if (next.status === "no_show" || next.arrival) {
    // late_no_arrival is superseded by no_show or by an observed arrival
    for (const exception of previous) {
      if (
        exception.state === "open" &&
        exception.kind === "late_no_arrival" &&
        !toResolveIds.includes(exception.id)
      ) {
        toResolveIds.push(exception.id)
      }
    }
  }
  return { visit: next, toRaise: delta.toRaise, toResolveIds }
}
