/**
 * Visit sweeper (EventBridge, every minute). Runs the time-driven half of the
 * Presence Engine: awaiting windows, late/no-show escalation, departure quiet
 * periods, and the unobservable overlay.
 */
import {
  DEFAULT_TOLERANCES,
  sweepVisits,
  systemResolution,
  type DoorEvent,
} from "@visitproof/domain"
import type { ScheduledEvent } from "aws-lambda"

import type { EngineDeps } from "../lib/ports"

export const handlerName = "visit-sweeper"

export function createVisitSweeper(deps: EngineDeps) {
  return async function visitSweeper(event: ScheduledEvent): Promise<void> {
    void event
    const now = deps.clock.now()
    const visits = await deps.visits.listActive()
    const openExceptions = await deps.exceptions.listOpen()

    const eventsByClient = new Map<string, DoorEvent[]>()
    for (const clientId of new Set(visits.map((visit) => visit.clientId))) {
      eventsByClient.set(clientId, await deps.events.listForClient(clientId))
    }
    const events = [...eventsByClient.values()].flat()

    const result = sweepVisits({
      visits,
      events,
      openExceptions,
      tolerances: DEFAULT_TOLERANCES,
      now,
    })
    for (const visit of result.visits) {
      await deps.visits.save(visit)
    }
    for (const exception of result.toRaise) {
      await deps.exceptions.open(exception)
    }
    for (const id of result.toResolveIds) {
      await deps.exceptions.resolve(id, systemResolution(now, "superseded by sweeper"))
    }
  }
}
