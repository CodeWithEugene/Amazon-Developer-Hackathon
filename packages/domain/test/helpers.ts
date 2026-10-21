/**
 * Test fixtures and a replay harness that drives processEvent plus a
 * one-minute sweepVisits with an injected clock, persisting visits and
 * exception cards the way the handlers do.
 */
import { processEvent, sweepVisits, type ArrivalJudge, type DeviceStates } from "../src/engine"
import type { ExceptionResolutionRequest } from "../src/exceptions"
import {
  DEFAULT_TOLERANCES,
  doorEventSchema,
  type Client,
  type DoorEvent,
  type Exception,
  type Tolerances,
  type Visit,
} from "../src/types"

export const MIN = 60_000
export const T = DEFAULT_TOLERANCES
export const START = "2026-10-01T13:00:00.000Z"
export const END = "2026-10-01T15:00:00.000Z"

export const audit = {
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
  version: 1,
}

export const at = (base: string, minutes: number): string =>
  new Date(Date.parse(base) + minutes * MIN).toISOString()

let seq = 0
export function event(
  when: string,
  type: DoorEvent["type"],
  subType?: string,
  overrides: Partial<DoorEvent> = {}
): DoorEvent {
  seq += 1
  return doorEventSchema.parse({
    ...audit,
    clientId: "c1",
    requestId: `req-${seq}`,
    timestampMs: Date.parse(when),
    at: when,
    type,
    subType,
    provenance: "emulated",
    rawPayloadHash: `hash-${seq}`,
    ...overrides,
  })
}

export const ding = (when: string, overrides: Partial<DoorEvent> = {}): DoorEvent =>
  event(when, "ding", undefined, overrides)
export const human = (when: string, overrides: Partial<DoorEvent> = {}): DoorEvent =>
  event(when, "motion", "human", overrides)

export function visit(overrides: Partial<Visit> = {}): Visit {
  return {
    ...audit,
    id: "v1",
    clientId: "c1",
    agencyId: "a1",
    caregiverId: "cg1",
    serviceCode: "T1019",
    date: "2026-10-01",
    scheduledStart: START,
    scheduledEnd: END,
    status: "scheduled",
    observability: { state: "observable", reasons: [] },
    ...overrides,
  }
}

export interface ReplayOptions {
  visits: readonly Visit[]
  events: readonly DoorEvent[]
  from: number
  to: number
  tolerances?: Tolerances
  judge?: ArrivalJudge
  client?: Pick<Client, "id" | "ringLinkStatus">
  deviceStates?: DeviceStates
  /** Pass every exception (any state) to the engine, not only open ones. */
  passAllExceptions?: boolean
  /** Called after every tick; may return exceptions a person changed. */
  onTick?: (now: number, exceptions: readonly Exception[]) => readonly Exception[]
}

export interface ReplayState {
  visits: Visit[]
  exceptions: Exception[]
  resolutions: ExceptionResolutionRequest[]
  raisedIds: string[]
}

function apply(
  state: ReplayState,
  result: { visits: readonly Visit[]; toRaise: readonly Exception[]; resolutions?: readonly ExceptionResolutionRequest[] },
  now: number
): ReplayState {
  const byId = new Map(result.visits.map((v) => [v.id, v]))
  const resolutions = result.resolutions ?? []
  const resolvedIds = new Set(resolutions.map((r) => r.id))
  const exceptions = state.exceptions.map((exception) => {
    const request = resolutions.find((r) => r.id === exception.id)
    if (!resolvedIds.has(exception.id) || exception.state !== "open" || !request) return exception
    return {
      ...exception,
      state: "resolved" as const,
      resolution: { by: "system", at: new Date(now).toISOString(), reason: request.reason },
    }
  })
  return {
    visits: state.visits.map((v) => byId.get(v.id) ?? v),
    exceptions: [...exceptions, ...result.toRaise],
    resolutions: [...state.resolutions, ...resolutions],
    raisedIds: [...state.raisedIds, ...result.toRaise.map((e) => e.id)],
  }
}

function engineExceptions(state: ReplayState, all: boolean) {
  const open = state.exceptions.filter((e) => e.state === "open")
  return all ? { openExceptions: open, exceptions: state.exceptions } : { openExceptions: open }
}

/** Replay events and one-minute sweeps from `from` to `to` (epoch ms). */
export function replay(options: ReplayOptions): ReplayState {
  const tolerances = options.tolerances ?? T
  const pending = [...options.events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  let state: ReplayState = { visits: [...options.visits], exceptions: [], resolutions: [], raisedIds: [] }
  let delivered: DoorEvent[] = []
  for (let tick = options.from; tick <= options.to; tick += MIN) {
    while (pending.length > 0 && Date.parse((pending[0] as DoorEvent).at) <= tick) {
      const next = pending.shift() as DoorEvent
      delivered = [...delivered, next]
      const now = new Date(Date.parse(next.at) + 1_000)
      const result = processEvent({
        event: next,
        events: delivered,
        visits: state.visits,
        ...engineExceptions(state, options.passAllExceptions ?? false),
        tolerances,
        now,
        judge: options.judge,
        client: options.client,
        deviceStates: options.deviceStates,
      })
      state = apply(state, { visits: result.visit ? [result.visit] : [], ...result }, now.getTime())
    }
    const swept = sweepVisits({
      visits: state.visits,
      events: delivered,
      ...engineExceptions(state, options.passAllExceptions ?? false),
      tolerances,
      now: new Date(tick),
      judge: options.judge,
      clients: options.client ? [options.client] : undefined,
      deviceStates: options.deviceStates ? { [options.visits[0]?.clientId ?? "c1"]: options.deviceStates } : undefined,
    })
    state = apply(state, swept, tick)
    if (options.onTick) state = { ...state, exceptions: [...options.onTick(tick, state.exceptions)] }
  }
  return state
}

export const kindsOf = (exceptions: readonly Exception[], state?: Exception["state"]): string[] =>
  exceptions
    .filter((e) => state === undefined || e.state === state)
    .map((e) => e.kind)
    .sort()
