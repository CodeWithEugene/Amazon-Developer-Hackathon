/**
 * Simulated-time replay of the Presence Engine (the demo and the
 * emulator-to-engine tests). Door events that were already persisted (by
 * the webhook receiver with VISITPROOF_ENGINE_INLINE=false) are ingested in
 * time order through the real event processor, and the real visit sweeper
 * runs on every tick, all against an injected clock. The engine only ever
 * sees door events at or before its clock, so a replay never reads the
 * future.
 */
import type { DoorEvent } from "@visitproof/domain"

import { ingestDoorEvent } from "./handlers/event-processor"
import { createVisitSweeper } from "./handlers/visit-sweeper"
import type { Clock, DoorEventStore, EngineDeps } from "./lib/ports"

/** The engine processes an event this long after it happened. */
export const REPLAY_EVENT_LAG_MS = 1_000

export interface SimulatedClock extends Clock {
  set(epochMs: number): void
}

export function simulatedClock(startMs: number): SimulatedClock {
  let current = startMs
  return {
    now: () => new Date(current),
    set: (epochMs) => {
      current = epochMs
    },
  }
}

/** A door event store that hides events after the clock. */
export function eventsAsOf(
  events: DoorEventStore,
  clock: Clock
): DoorEventStore {
  return {
    append: (event) => events.append(event),
    listForClient: async (clientId) => {
      const cutoff = clock.now().getTime()
      return (await events.listForClient(clientId)).filter(
        (event) => event.timestampMs <= cutoff
      )
    },
  }
}

export interface ReplayWindow {
  /** Persisted door events to ingest, in any order. */
  events: readonly DoorEvent[]
  from: number
  to: number
  tickMs: number
}

export interface ReplayHooks {
  /** Called after each tick's sweep (progress reporting). */
  onTick?(epochMs: number): void | Promise<void>
}

export interface ReplaySummary {
  events: number
  ticks: number
}

/** Replays `window` through the event processor and sweeper on `clock`. */
export async function replayInSimulatedTime(
  deps: EngineDeps,
  clock: SimulatedClock,
  window: ReplayWindow,
  hooks: ReplayHooks = {}
): Promise<ReplaySummary> {
  if (!(window.tickMs > 0) || window.to < window.from) {
    throw new RangeError("replay needs a positive tick and from <= to")
  }
  const engine: EngineDeps = {
    ...deps,
    clock,
    events: eventsAsOf(deps.events, clock),
  }
  const sweep = createVisitSweeper(engine)
  const pending = [...window.events].sort(
    (a, b) =>
      a.timestampMs - b.timestampMs || a.requestId.localeCompare(b.requestId)
  )
  let cursor = 0
  let ticks = 0
  let latest = window.from
  for (let tick = window.from; tick <= window.to; tick += window.tickMs) {
    while (cursor < pending.length && pending[cursor]!.timestampMs <= tick) {
      const event = pending[cursor]!
      cursor += 1
      latest = Math.max(latest, event.timestampMs + REPLAY_EVENT_LAG_MS)
      clock.set(latest)
      await ingestDoorEvent(engine, event, { persist: false })
    }
    // Never move the clock backwards past an event just processed.
    clock.set(Math.max(tick, latest))
    await sweep({} as never)
    ticks += 1
    await hooks.onTick?.(tick)
  }
  return { events: cursor, ticks }
}
