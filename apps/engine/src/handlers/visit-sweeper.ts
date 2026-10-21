/**
 * Visit sweeper (EventBridge, every minute). Runs the time-driven half of the
 * Presence Engine: awaiting windows, late/no-show escalation, departure quiet
 * periods, and the unobservable overlay. Each agency is swept with its own
 * configured tolerances and time zone; settled visits are passed as context
 * so events in overlapping windows stay with the right visit, and only
 * visits that changed are saved.
 */
import {
  sweepVisits,
  type DeviceStates,
  type DoorEvent,
  type Visit,
} from "@visitproof/domain"
import type { ScheduledEvent } from "aws-lambda"

import { timeZoneFor, tolerancesFor } from "../lib/agency"
import { applyExceptions, applyVisit } from "../lib/apply"
import type { EngineDeps } from "../lib/ports"

export const handlerName = "visit-sweeper"

const groupBy = <T>(
  items: readonly T[],
  key: (item: T) => string
): Map<string, T[]> =>
  items.reduce(
    (groups, item) =>
      groups.set(key(item), [...(groups.get(key(item)) ?? []), item]),
    new Map<string, T[]>()
  )

const uniqueClientIds = (visits: readonly Visit[]): string[] => [
  ...new Set(visits.map((visit) => visit.clientId)),
]

async function perClient<T>(
  clientIds: readonly string[],
  load: (clientId: string) => Promise<T>
): Promise<Map<string, T>> {
  const values = await Promise.all(clientIds.map(load))
  return new Map(clientIds.map((clientId, index) => [clientId, values[index]!]))
}

async function deviceStatesFor(
  deps: EngineDeps,
  clientIds: readonly string[],
  now: Date
): Promise<Record<string, DeviceStates>> {
  if (!deps.devices) return {}
  const states = await perClient(clientIds, (id) =>
    deps.devices!.forClient(id, now)
  )
  return Object.fromEntries(
    [...states].filter(
      (entry): entry is [string, DeviceStates] => entry[1] !== undefined
    )
  )
}

async function sweepAgency(
  deps: EngineDeps,
  agencyId: string,
  visits: Visit[],
  now: Date
) {
  const clientIds = uniqueClientIds(visits)
  const [events, exceptions, clients, context] = await Promise.all([
    perClient(clientIds, (id) => deps.events.listForClient(id)),
    perClient(clientIds, (id) => deps.exceptions.listForClient(id)),
    perClient(clientIds, (id) => deps.clients.get(id)),
    perClient(clientIds, (id) => deps.visits.listForClient(id)),
  ])
  const allExceptions = [...exceptions.values()].flat()
  const result = sweepVisits({
    visits,
    events: [...events.values()].flat() as DoorEvent[],
    openExceptions: allExceptions.filter((e) => e.state === "open"),
    exceptions: allExceptions,
    contextVisits: [...context.values()].flat(),
    tolerances: await tolerancesFor(deps, agencyId),
    now,
    clients: [...clients.values()].filter((client) => client !== undefined),
    deviceStates: await deviceStatesFor(deps, clientIds, now),
    timeZone: await timeZoneFor(deps, agencyId),
  })
  const before = new Map(visits.map((visit) => [visit.id, visit]))
  for (const visit of result.visits) {
    await applyVisit(deps, before.get(visit.id), visit, now)
  }
  await applyExceptions(
    deps,
    {
      toRaise: result.toRaise,
      resolutions: result.resolutions ?? [],
      existing: allExceptions,
    },
    now
  )
}

export function createVisitSweeper(deps: EngineDeps) {
  return async function visitSweeper(event: ScheduledEvent): Promise<void> {
    void event
    const now = deps.clock.now()
    const byAgency = groupBy(
      await deps.visits.listActive(),
      (visit) => visit.agencyId
    )
    for (const [agencyId, visits] of byAgency) {
      await sweepAgency(deps, agencyId, visits, now)
    }
  }
}
