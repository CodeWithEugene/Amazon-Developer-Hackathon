/**
 * Presence Engine orchestrators (docs/build.md Section 6,
 * .kiro/specs/presence-engine): event processing and the visit sweeper.
 * Both run the same per-visit step (./evaluate), then plan exception cards
 * (./exceptions). Pure functions with injected time and judgments; the
 * primitives are re-exported here for a single import surface.
 */
import type { ArrivalJudge, ArrivalJudgment } from "./arrival"
import { evaluateVisit } from "./evaluate"
import { planExceptions, type ExceptionResolutionRequest } from "./exceptions"
import type { DeviceStates } from "./observability"
import type { Client, DoorEvent, Exception, Tolerances, Visit } from "./types"
import { assignEvents, assignVisit } from "./window"

export * from "./presence"
export * from "./reconcile"
export * from "./exceptions"
export { desiredExceptionKinds, evaluateVisit, SEAL_AFTER_WINDOW_MIN } from "./evaluate"
export type { VisitContext, VisitEvaluation } from "./evaluate"

type ClientState = Pick<Client, "id" | "ringLinkStatus">

// ---------------------------------------------------------------------------
// Event processing (webhook / stream path)
// ---------------------------------------------------------------------------

export interface ProcessEventInput {
  event: DoorEvent
  /** All door events for the client, including `event`. */
  events: readonly DoorEvent[]
  /** The client's visits (all of them, so overlapping windows split correctly). */
  visits: readonly Visit[]
  /** Open exceptions; pass `exceptions` too so resolved and snoozed cards are never re-raised. */
  openExceptions: readonly Exception[]
  /** Every exception for the client's visits, in any state. */
  exceptions?: readonly Exception[]
  tolerances: Tolerances
  now: Date
  judge?: ArrivalJudge
  /** The client, for the ringLinkStatus overlay (paused or removed). */
  client?: Pick<Client, "ringLinkStatus">
  /** Current device and integration state for the client. */
  deviceStates?: DeviceStates
  /** Agency time zone for times in resolution notes. */
  timeZone?: string
}

export interface ProcessEventResult {
  matched: boolean
  visit?: Visit
  toRaise: Exception[]
  toResolveIds: string[]
  /** One entry per id in `toResolveIds`, with the reason to record. */
  resolutions?: ExceptionResolutionRequest[]
  /** The Judge call, when two arrival clusters were compared (log it as evidence). */
  judgment?: ArrivalJudgment
}

function existingFor(input: {
  openExceptions: readonly Exception[]
  exceptions?: readonly Exception[]
}): Exception[] {
  const byId = new Map<string, Exception>()
  for (const exception of [...(input.exceptions ?? []), ...input.openExceptions]) {
    byId.set(exception.id, exception)
  }
  return [...byId.values()]
}

/** Apply one door event to the visit it belongs to (EARS rules 1 to 8). */
export function processEvent(input: ProcessEventInput): ProcessEventResult {
  const { event, now } = input
  const clientVisits = input.visits.filter((visit) => visit.clientId === event.clientId)
  const visit = assignVisit(event, clientVisits)
  if (!visit) return { matched: false, toRaise: [], toResolveIds: [], resolutions: [] }
  const events = input.events.filter((candidate) => candidate.clientId === event.clientId)
  const evaluation = evaluateVisit(visit, {
    events: events.some((candidate) => candidate.requestId === event.requestId) ? events : [...events, event],
    clientVisits,
    tolerances: input.tolerances,
    now,
    judge: input.judge,
    ringLinkStatus: input.client?.ringLinkStatus,
    deviceStates: input.deviceStates,
  })
  const plan = planExceptions(evaluation.visit, evaluation.desired, existingFor(input), now, input.timeZone)
  return {
    matched: true,
    visit: plan.visit,
    toRaise: plan.toRaise,
    toResolveIds: plan.resolutions.map((request) => request.id),
    resolutions: plan.resolutions,
    ...(evaluation.judgment ? { judgment: evaluation.judgment } : {}),
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
  /** Every exception for the swept visits, in any state. */
  exceptions?: readonly Exception[]
  /**
   * Every visit for the involved clients, including settled ones not being
   * swept, so events in overlapping windows go to the right visit.
   */
  contextVisits?: readonly Visit[]
  tolerances: Tolerances
  now: Date
  judge?: ArrivalJudge
  /** Clients for the ringLinkStatus overlay. */
  clients?: readonly ClientState[]
  /** Current device and integration state keyed by client id. */
  deviceStates?: Readonly<Record<string, DeviceStates>>
  timeZone?: string
}

export interface SweepVisitsResult {
  visits: Visit[]
  toRaise: Exception[]
  toResolveIds: string[]
  resolutions?: ExceptionResolutionRequest[]
}

function visitsByClient(input: SweepVisitsInput): Map<string, Visit[]> {
  const grouped = new Map<string, Visit[]>()
  const all = [...(input.contextVisits ?? []), ...input.visits]
  for (const visit of all) {
    const list = grouped.get(visit.clientId) ?? []
    if (!list.some((candidate) => candidate.id === visit.id)) grouped.set(visit.clientId, [...list, visit])
  }
  return grouped
}

function groupByClient(events: readonly DoorEvent[]): Map<string, DoorEvent[]> {
  const grouped = new Map<string, DoorEvent[]>()
  for (const event of events) grouped.set(event.clientId, [...(grouped.get(event.clientId) ?? []), event])
  return grouped
}

/** Time-driven transitions: awaiting, late, no-show, departure, unobservable. */
export function sweepVisits(input: SweepVisitsInput): SweepVisitsResult {
  const { now } = input
  const clientVisits = visitsByClient(input)
  const eventsByClient = groupByClient(input.events)
  const assigned = new Map<string, ReadonlyMap<string, readonly DoorEvent[]>>()
  const existing = existingFor(input)
  const ringLinkStatus = new Map((input.clients ?? []).map((client) => [client.id, client.ringLinkStatus]))
  const results = input.visits.map((visit) => {
    const events = eventsByClient.get(visit.clientId) ?? []
    const visits = clientVisits.get(visit.clientId) ?? [visit]
    const byVisit = assigned.get(visit.clientId) ?? assignEvents(events, visits)
    assigned.set(visit.clientId, byVisit)
    const evaluation = evaluateVisit(visit, {
      events,
      clientVisits: visits,
      ownEvents: byVisit.get(visit.id) ?? [],
      tolerances: input.tolerances,
      now,
      judge: input.judge,
      ringLinkStatus: ringLinkStatus.get(visit.clientId),
      deviceStates: input.deviceStates?.[visit.clientId],
    })
    return planExceptions(evaluation.visit, evaluation.desired, existing, now, input.timeZone)
  })
  const toRaise = [...new Map(results.flatMap((r) => r.toRaise).map((e) => [e.id, e])).values()]
  const resolutions = results.flatMap((result) => result.resolutions)
  return {
    visits: results.map((result) => result.visit),
    toRaise,
    toResolveIds: resolutions.map((request) => request.id),
    resolutions,
  }
}
