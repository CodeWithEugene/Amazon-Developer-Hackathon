/**
 * Applies Presence Engine results to the ports, shared by the event
 * processor and the visit sweeper: save a visit only when it changed,
 * open raised cards, apply system resolutions with their recorded reason,
 * and append the matching signed ledger records as they happen.
 */
import {
  canonicalJson,
  systemResolution,
  type DoorEvent,
  type Exception,
  type ExceptionResolutionRequest,
  type Visit,
} from "@visitproof/domain"

import type { EngineDeps, LedgerEntry } from "./ports"

type ApplyDeps = Pick<EngineDeps, "visits" | "exceptions" | "ledger">

/** The observation fields a ledger record captures for a visit. */
const observation = (visit: Visit) => ({
  status: visit.status,
  arrival: visit.arrival ?? null,
  departure: visit.departure ?? null,
  observability: visit.observability,
})

const appendLedger = async (
  deps: ApplyDeps,
  entry: LedgerEntry
): Promise<void> => {
  if (deps.ledger) await deps.ledger.append(entry)
}

/** One observed record per door event the engine ingests. */
export async function ledgerDoorEvent(
  deps: ApplyDeps,
  event: DoorEvent,
  now: Date
): Promise<void> {
  await appendLedger(deps, {
    clientId: event.clientId,
    column: "observed",
    subject: event.requestId,
    payload: {
      kind: "door_event",
      type: event.type,
      subType: event.subType ?? null,
      eventAt: event.at,
      deviceId: event.deviceId ?? null,
      provenance: event.provenance,
      rawPayloadHash: event.rawPayloadHash,
    },
    at: now,
  })
}

/**
 * Saves `after` when it differs from `before`, and appends an observed
 * record when the status, arrival, departure, or observability changed.
 * Returns true when the visit was saved.
 */
export async function applyVisit(
  deps: ApplyDeps,
  before: Visit | undefined,
  after: Visit,
  now: Date
): Promise<boolean> {
  if (before && canonicalJson(before) === canonicalJson(after)) return false
  await deps.visits.save(after)
  const observed = observation(after)
  if (before && canonicalJson(observation(before)) === canonicalJson(observed))
    return true
  await appendLedger(deps, {
    clientId: after.clientId,
    column: "observed",
    subject: after.id,
    payload: { kind: "visit_observation", ...observed },
    at: now,
  })
  return true
}

/**
 * Opens raised cards and applies system resolutions, ledgering each.
 * `existing` holds the cards the engine saw (any state), so a resolution
 * can be attributed to its client.
 */
export async function applyExceptions(
  deps: ApplyDeps,
  plan: {
    toRaise: readonly Exception[]
    resolutions: readonly ExceptionResolutionRequest[]
    existing: readonly Exception[]
  },
  now: Date
): Promise<void> {
  for (const exception of plan.toRaise) {
    await deps.exceptions.open(exception)
    await appendLedger(deps, {
      clientId: exception.clientId,
      column: "observed",
      subject: exception.id,
      payload: {
        kind: "exception_raised",
        exceptionKind: exception.kind,
        visitId: exception.visitId,
      },
      at: now,
    })
  }
  const clientOf = new Map(
    plan.existing.map((exception) => [exception.id, exception.clientId])
  )
  for (const request of plan.resolutions) {
    const resolution = systemResolution(now, request.reason, request.note)
    await deps.exceptions.resolve(request.id, resolution)
    const clientId = clientOf.get(request.id)
    if (clientId === undefined) continue
    await appendLedger(deps, {
      clientId,
      column: "resolved",
      subject: request.id,
      payload: {
        kind: "exception_resolved",
        by: resolution.by,
        reason: resolution.reason,
      },
      at: now,
    })
  }
}
