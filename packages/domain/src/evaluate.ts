/**
 * One Presence Engine step for one visit at `now` (EARS rules 1 to 8). Both
 * the event path (processEvent) and the time path (sweepVisits) call this,
 * so they cannot disagree. The step is a pure function of the visit, the
 * client's door events, the client's other visits, and injected state.
 */
import {
  arrivalCandidates,
  chooseArrival,
  type ArrivalJudge,
  type ArrivalJudgment,
} from "./arrival"
import { evaluateDeparture, type DepartureEvaluation } from "./departure"
import { canonicalJson } from "./ledger"
import { assessVisitObservability, type DeviceStates } from "./observability"
import type {
  DoorEvent,
  ExceptionKind,
  RingLinkStatus,
  Tolerances,
  Visit,
  VisitBoundary,
  VisitStatus,
} from "./types"
import { assignVisit, eventsForVisit, visitWindow } from "./window"

const MIN = 60_000

/** A settled visit is left alone this long after its window closes. */
export const SEAL_AFTER_WINDOW_MIN = 60

const SETTLED: ReadonlySet<VisitStatus> = new Set([
  "completed",
  "early_departure",
  "departure_not_observed",
  "no_show",
  "unobservable",
])

export interface VisitContext {
  /** All door events for the visit's client. */
  events: readonly DoorEvent[]
  /** Every visit for the client (used to split overlapping windows). */
  clientVisits: readonly Visit[]
  tolerances: Tolerances
  now: Date
  judge?: ArrivalJudge
  ringLinkStatus?: RingLinkStatus
  deviceStates?: DeviceStates
  /** Precomputed events assigned to this visit (skips reassignment). */
  ownEvents?: readonly DoorEvent[]
}

export interface VisitEvaluation {
  visit: Visit
  desired: ExceptionKind[]
  judgment?: ArrivalJudgment
}

interface ArrivalState {
  arrival?: VisitBoundary
  ambiguous: boolean
  judgment?: ArrivalJudgment
}

function isSealed(visit: Visit, nowMs: number): boolean {
  return SETTLED.has(visit.status) && nowMs > visitWindow(visit).to + SEAL_AFTER_WINDOW_MIN * MIN
}

function resolveArrival(visit: Visit, own: readonly DoorEvent[], ctx: VisitContext): ArrivalState {
  const nowMs = ctx.now.getTime()
  const graceEnd = Date.parse(visit.scheduledStart) + ctx.tolerances.graceMin * MIN
  if (visit.arrival && (visit.arrival.source === "manual" || nowMs > graceEnd)) {
    return { arrival: visit.arrival, ambiguous: false }
  }
  if (!visit.arrival && visit.status === "ambiguous") return { ambiguous: true }
  const result = chooseArrival(visit, arrivalCandidates(visit, own), {
    judge: ctx.judge,
    graceMin: ctx.tolerances.graceMin,
  })
  if (result.outcome === "chosen") return { arrival: result.arrival, ambiguous: false, judgment: result.judgment }
  if (result.outcome === "ambiguous") return { ambiguous: true, judgment: result.judgment }
  return { ambiguous: false }
}

function afterWindowSignals(visit: Visit, ctx: VisitContext): readonly DoorEvent[] {
  const { to } = visitWindow(visit)
  return ctx.events.filter(
    (event) => Date.parse(event.at) > to && assignVisit(event, ctx.clientVisits) === null
  )
}

function resolveDeparture(
  visit: Visit,
  own: readonly DoorEvent[],
  ctx: VisitContext
): { departure?: VisitBoundary; evaluation?: DepartureEvaluation } {
  if (!visit.arrival) return {}
  if (visit.departure?.source === "manual") return { departure: visit.departure }
  const evaluation = evaluateDeparture({
    visit,
    events: own,
    afterWindow: afterWindowSignals(visit, ctx),
    tolerances: ctx.tolerances,
    now: ctx.now,
  })
  if (evaluation.state === "departed") return { departure: evaluation.departure, evaluation }
  if (evaluation.state === "not_observed") return { evaluation }
  // Pending: keep an already recorded (on-time) departure until the new
  // activity is followed by its own quiet period.
  return { departure: visit.departure, evaluation }
}

function statusWithoutArrival(visit: Visit, nowMs: number, ctx: VisitContext): VisitStatus {
  const start = Date.parse(visit.scheduledStart)
  if (nowMs < start - 30 * MIN) return "scheduled"
  if (nowMs < start + ctx.tolerances.escalationMin * MIN) return "awaiting_arrival"
  return "no_show"
}

function deriveStatus(
  visit: Visit,
  arrival: ArrivalState,
  departure: DepartureEvaluation | undefined,
  ctx: VisitContext
): VisitStatus {
  const nowMs = ctx.now.getTime()
  if (visit.observability.state === "unobservable") return "unobservable"
  if (!visit.arrival) return arrival.ambiguous ? "ambiguous" : statusWithoutArrival(visit, nowMs, ctx)
  if (departure?.state === "not_observed") return "departure_not_observed"
  const { end } = visitWindow(visit)
  if (visit.departure) {
    const cutoff = end - ctx.tolerances.earlyDepartureMin * MIN
    return Date.parse(visit.departure.at) < cutoff ? "early_departure" : "completed"
  }
  const arrivalMs = Date.parse(visit.arrival.at)
  if (arrivalMs > Date.parse(visit.scheduledStart) + ctx.tolerances.graceMin * MIN) return "arrived_late"
  if (nowMs >= arrivalMs + ctx.tolerances.departureQuietMin * MIN) return "in_progress"
  return "arrived_on_time"
}

/** The exception kinds a visit in this state should carry (EARS 3 to 8). */
export function desiredExceptionKinds(visit: Visit, now: Date, tolerances: Tolerances): ExceptionKind[] {
  if (visit.status === "unobservable") return ["unobservable"]
  if (visit.status === "ambiguous") return ["ambiguous"]
  const start = Date.parse(visit.scheduledStart)
  const nowMs = now.getTime()
  if (!visit.arrival) {
    if (nowMs >= start + tolerances.escalationMin * MIN) return ["no_show"]
    return nowMs >= start + tolerances.graceMin * MIN ? ["late_no_arrival"] : []
  }
  const late =
    visit.arrival.source !== "manual" && Date.parse(visit.arrival.at) > start + tolerances.graceMin * MIN
  return [
    ...(late ? ["late_arrival" as const] : []),
    ...(visit.status === "early_departure" ? ["early_departure" as const] : []),
  ]
}

/** A copy of the visit with these boundaries; absent ones are omitted, not set to undefined. */
function withBoundaries(visit: Visit, arrival?: VisitBoundary, departure?: VisitBoundary): Visit {
  const entries = Object.entries({
    ...visit,
    arrival,
    departure: arrival ? departure : undefined,
  }).filter(([, value]) => value !== undefined)
  return Object.fromEntries(entries) as Visit
}

/** Evaluate one visit at `ctx.now`. Returns the visit unchanged when nothing moved. */
export function evaluateVisit(visit: Visit, ctx: VisitContext): VisitEvaluation {
  const nowMs = ctx.now.getTime()
  if (isSealed(visit, nowMs)) return { visit, desired: [] }
  const own = (ctx.ownEvents ?? eventsForVisit(visit, ctx.events, ctx.clientVisits)).filter(
    (event) => Date.parse(event.at) <= nowMs
  )
  const observability = assessVisitObservability(visit, {
    events: ctx.events,
    now: ctx.now,
    ringLinkStatus: ctx.ringLinkStatus,
    deviceStates: ctx.deviceStates,
  })
  // The overlay freezes the presence record: boundaries observed before the
  // door became unobservable stay, but no new ones are derived from it.
  const frozen = observability.state === "unobservable"
  const arrival: ArrivalState = frozen
    ? { arrival: visit.arrival, ambiguous: false }
    : resolveArrival(visit, own, ctx)
  const withArrival = withBoundaries({ ...visit, observability }, arrival.arrival, visit.departure)
  const departure = frozen ? { departure: visit.departure } : resolveDeparture(withArrival, own, ctx)
  const bounded = withBoundaries(withArrival, arrival.arrival, departure.departure)
  const next: Visit = { ...bounded, status: deriveStatus(bounded, arrival, departure.evaluation, ctx) }
  const stable = canonicalJson(next) === canonicalJson(visit) ? visit : next
  return {
    visit: stable,
    desired: desiredExceptionKinds(stable, ctx.now, ctx.tolerances),
    ...(arrival.judgment ? { judgment: arrival.judgment } : {}),
  }
}
