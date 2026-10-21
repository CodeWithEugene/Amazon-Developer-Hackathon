/**
 * Exception cards: deterministic ids, diffing, and system resolutions.
 * Raising is idempotent: a kind the engine already requested for a visit
 * (recorded on `visit.raisedExceptionKinds`) or an id that already exists in
 * any state is never requested again, so a card a person resolved or
 * snoozed does not come back on the next sweep.
 */
import { formatLocalTime } from "./time"
import type { Exception, ExceptionKind, ExceptionResolution, Visit } from "./types"

export interface ExceptionDelta {
  toRaise: Exception[]
  toResolveIds: string[]
}

/** A system resolution the caller should apply, with a plain reason for the Resolved column. */
export interface ExceptionResolutionRequest {
  id: string
  reason: string
  note?: string
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
 * kind is a human-review card: the engine raises it, and only a person may
 * resolve it, with one exception: a `no_show` card is closed by the system
 * when the caregiver's arrival is observed after the escalation.
 */
export const SYSTEM_OWNED_EXCEPTION_KINDS: readonly Exception["kind"][] = Object.freeze([
  "late_no_arrival",
])

/**
 * Diff desired exceptions against existing ones; deterministic ids dedupe.
 * `previous` may hold exceptions in any state: an id that exists in any
 * state is not raised again. Only open system-owned kinds are auto-resolved
 * when they fall out of the desired set.
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

export function systemResolution(now: Date, reason: string, note?: string): ExceptionResolution {
  return { by: "system", at: now.toISOString(), reason, ...(note ? { note } : {}) }
}

export interface ExceptionPlan {
  visit: Visit
  toRaise: Exception[]
  resolutions: ExceptionResolutionRequest[]
}

function lateNoArrivalReason(visit: Visit): string {
  if (visit.status === "unobservable") return "Door unobservable"
  if (visit.status === "ambiguous") return "Arrival needs review"
  if (visit.arrival) return "Arrival observed"
  if (visit.status === "no_show") return "Escalated to no-show"
  return "Superseded"
}

function resolutionFor(
  visit: Visit,
  exception: Exception,
  desired: ReadonlySet<ExceptionKind>,
  timeZone: string | undefined
): ExceptionResolutionRequest | null {
  if (exception.state !== "open" || desired.has(exception.kind)) return null
  if (exception.kind === "late_no_arrival") {
    return { id: exception.id, reason: lateNoArrivalReason(visit) }
  }
  if (exception.kind === "no_show" && visit.arrival && visit.arrival.source !== "manual") {
    const at = timeZone ? formatLocalTime(visit.arrival.at, timeZone) : visit.arrival.at
    return {
      id: exception.id,
      reason: "Arrived after no-show escalation",
      note: `The door recorded an arrival at ${at} after the no-show escalation, so the visit is marked arrived late.`,
    }
  }
  return null
}

/**
 * Turn the kinds a visit should carry into cards to raise and system
 * resolutions to apply. `existing` holds this visit's exceptions (any state).
 * `timeZone` renders times in resolution notes (agency time zone).
 */
export function planExceptions(
  visit: Visit,
  desiredKinds: readonly ExceptionKind[],
  existing: readonly Exception[],
  now: Date,
  timeZone?: string
): ExceptionPlan {
  const own = existing.filter((exception) => exception.visitId === visit.id)
  const existingIds = new Set(own.map((exception) => exception.id))
  const remembered = new Set(visit.raisedExceptionKinds ?? [])
  const desired = new Set(desiredKinds)
  const toRaise = [...desired]
    .filter((kind) => !remembered.has(kind))
    .map((kind) => buildException(kind, visit, now))
    .filter((exception) => !existingIds.has(exception.id))
  const resolutions = own
    .map((exception) => resolutionFor(visit, exception, desired, timeZone))
    .filter((request): request is ExceptionResolutionRequest => request !== null)
  const memory = [...new Set([...remembered, ...desired])].sort()
  const next: Visit =
    memory.length === remembered.size ? visit : { ...visit, raisedExceptionKinds: memory }
  return { visit: next, toRaise, resolutions }
}
