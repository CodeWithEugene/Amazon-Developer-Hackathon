/**
 * Presence primitives: arrival candidates and judgments, departure
 * detection, observability assessment, and the visit status machine.
 * Pure functions; all time comes from injected parameters.
 */
import type {
  Consent,
  Device,
  DoorEvent,
  IntegrationStatus,
  Observability,
  ObservabilityReason,
  RingLinkStatus,
  Tolerances,
  Visit,
  VisitBoundary,
  VisitStatus,
} from "./types"
import { EncryptionState } from "./types"

const MIN = 60_000

// ---------------------------------------------------------------------------
// Arrival candidates and judgments
// ---------------------------------------------------------------------------

export interface ArrivalCandidate {
  at: string
  eventId: string
  kind: "ding" | "human_motion"
}

export interface ArrivalChoice {
  scheduledStart: string
  candidates: ArrivalCandidate[]
  caregiverUsualArrivalOffsetMin?: number
}

export interface ArrivalDecision {
  at: string
  confidence: number
}

export interface ArrivalJudge {
  chooseArrival(choice: ArrivalChoice): ArrivalDecision | null
}

/** Deterministic fallback judge: the candidate closest to the scheduled start. */
export const ruleJudge: ArrivalJudge = {
  chooseArrival({ scheduledStart, candidates }) {
    if (candidates.length === 0) return null
    const start = Date.parse(scheduledStart)
    let best = candidates[0] as ArrivalCandidate
    let bestDist = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      const dist = Math.abs(Date.parse(candidate.at) - start)
      if (dist < bestDist) {
        bestDist = dist
        best = candidate
      }
    }
    return { at: best.at, confidence: 0.75 }
  },
}

export function isArrivalSignal(
  event: Pick<DoorEvent, "type" | "subType">
): boolean {
  return event.type === "ding" || (event.type === "motion" && event.subType === "human")
}

/** Candidates within [start - 30 min, start + 60 min] (EARS rules 2, 3, 5). */
export function arrivalCandidates(
  visit: Visit,
  events: readonly DoorEvent[]
): ArrivalCandidate[] {
  const start = Date.parse(visit.scheduledStart)
  const from = start - 30 * MIN
  const to = start + 60 * MIN
  return events
    .filter((event) => isArrivalSignal(event))
    .filter((event) => {
      const at = Date.parse(event.at)
      return at >= from && at <= to
    })
    .map((event) => ({
      at: event.at,
      eventId: event.requestId,
      kind: event.type === "ding" ? ("ding" as const) : ("human_motion" as const),
    }))
}

/** Group candidates separated by more than 20 minutes into distinct clusters. */
export function clusterCandidates(
  candidates: readonly ArrivalCandidate[]
): ArrivalCandidate[][] {
  const sorted = [...candidates].sort((a, b) => a.at.localeCompare(b.at))
  const clusters: ArrivalCandidate[][] = []
  for (const candidate of sorted) {
    const last = clusters.at(-1)
    if (
      last &&
      Date.parse(candidate.at) - Date.parse((last.at(-1) as ArrivalCandidate).at) <= 20 * MIN
    ) {
      last.push(candidate)
    } else {
      clusters.push([candidate])
    }
  }
  return clusters
}

export type ArrivalChoiceResult =
  | { outcome: "chosen"; arrival: VisitBoundary; method: "rule" | "jev" }
  | { outcome: "ambiguous" }
  | { outcome: "none" }

export interface ChooseArrivalContext {
  judge?: ArrivalJudge
  caregiverUsualArrivalOffsetMin?: number
}

export function chooseArrival(
  visit: Visit,
  candidates: readonly ArrivalCandidate[],
  context: ChooseArrivalContext = {}
): ArrivalChoiceResult {
  const clusters = clusterCandidates(candidates)
  if (clusters.length === 0) return { outcome: "none" }
  if (clusters.length === 1) {
    const first = (clusters[0] as ArrivalCandidate[])[0] as ArrivalCandidate
    return {
      outcome: "chosen",
      method: "rule",
      arrival: {
        at: first.at,
        eventId: first.eventId,
        source: "rule",
        confidence: 0.9,
      },
    }
  }
  const judge = context.judge ?? ruleJudge
  const flat = clusters.flat()
  const decision = judge.chooseArrival({
    scheduledStart: visit.scheduledStart,
    candidates: flat,
    caregiverUsualArrivalOffsetMin: context.caregiverUsualArrivalOffsetMin,
  })
  if (!decision || decision.confidence < 0.7) return { outcome: "ambiguous" }
  const chosen = flat.find((candidate) => candidate.at === decision.at)
  if (!chosen) return { outcome: "ambiguous" }
  return {
    outcome: "chosen",
    method: "jev",
    arrival: {
      at: chosen.at,
      eventId: chosen.eventId,
      source: "jev",
      confidence: decision.confidence,
    },
  }
}

// ---------------------------------------------------------------------------
// Departure
// ---------------------------------------------------------------------------

export type DepartureResult = VisitBoundary | "not_observed"

/** Last arrival signal after arrival, once quiet for departureQuietMin (EARS 6, 7). */
export function detectDeparture(
  visit: Visit,
  events: readonly DoorEvent[],
  quietMin: number,
  now: Date
): DepartureResult {
  if (!visit.arrival) return "not_observed"
  const arrivalMs = Date.parse(visit.arrival.at)
  const windowEnd = Date.parse(visit.scheduledEnd) + 60 * MIN
  const signals = events
    .filter((event) => isArrivalSignal(event))
    .filter((event) => Date.parse(event.at) > arrivalMs)
    .sort((a, b) => a.at.localeCompare(b.at))
  if (signals.length === 0) return "not_observed"
  const last = signals.at(-1) as DoorEvent
  // EARS 7: activity continuing past end + 60 min means no departure can be pinned
  if (Date.parse(last.at) > windowEnd) return "not_observed"
  if (now.getTime() - Date.parse(last.at) < quietMin * MIN) return "not_observed"
  return {
    at: last.at,
    eventId: last.requestId,
    source: "rule",
  }
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export interface ObservabilityInput {
  devices: readonly Device[]
  integrationStatus?: IntegrationStatus
  encryptionState?: EncryptionState
  ringLinkStatus?: RingLinkStatus
  consent?: Consent
}

/** Reasons the door cannot be trusted for a window (EARS rule 8). */
export function assessObservability(input: ObservabilityInput): Observability {
  const reasons: ObservabilityReason[] = []
  const frontDoors = input.devices.filter((device) => device.role === "front_door")
  if (frontDoors.length === 0) reasons.push("no_front_door_device")
  for (const device of frontDoors) {
    if (!device.online) reasons.push("device_offline")
    if (!device.motionRecordingEnabled) reasons.push("motion_recording_off")
    if (!device.hasMotionZone) reasons.push("no_motion_zone")
  }
  // TAKE-encrypted and E2EE devices both degrade to unobservable
  // (docs/solution.md Section 4): events may flow, but the door record
  // cannot be trusted as evidence either way.
  if (input.encryptionState === "e2ee" || input.encryptionState === "take") {
    reasons.push("encrypted_device")
  }
  if (input.integrationStatus === "removed") reasons.push("integration_removed")
  if (input.ringLinkStatus === "paused") reasons.push("integration_paused")
  if (input.ringLinkStatus === "removed") reasons.push("consent_withdrawn")
  if (input.consent && !input.consent.shareWithAgency) reasons.push("consent_withdrawn")
  const unique = [...new Set(reasons)]
  return { state: unique.length > 0 ? "unobservable" : "observable", reasons: unique }
}

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

const TERMINAL: ReadonlySet<VisitStatus> = new Set([
  "completed",
  "early_departure",
  "departure_not_observed",
  "no_show",
])

export function isTerminalStatus(status: VisitStatus): boolean {
  return TERMINAL.has(status)
}

/** Time-based status from schedule, arrival, and departure (no events needed). */
export function classifyVisit(
  visit: Visit,
  now: Date,
  tolerances: Tolerances
): VisitStatus {
  if (visit.observability.state === "unobservable") return "unobservable"
  const start = Date.parse(visit.scheduledStart)
  const end = Date.parse(visit.scheduledEnd)
  const nowMs = now.getTime()
  if (!visit.arrival) {
    if (nowMs < start - 30 * MIN) return "scheduled"
    if (nowMs <= start + tolerances.escalationMin * MIN) return "awaiting_arrival"
    return "no_show"
  }
  if (visit.departure) {
    const earlyCutoff = Date.parse(shiftIso(visit.scheduledEnd, -tolerances.earlyDepartureMin))
    return Date.parse(visit.departure.at) < earlyCutoff ? "early_departure" : "completed"
  }
  if (nowMs > end + 60 * MIN) return "departure_not_observed"
  return "in_progress"
}

export function shiftIso(iso: string, minutes: number): string {
  return new Date(Date.parse(iso) + minutes * MIN).toISOString()
}
