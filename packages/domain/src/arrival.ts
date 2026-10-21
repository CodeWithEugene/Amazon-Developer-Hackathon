/**
 * Arrival candidates, clustering, and judgments (EARS rules 2, 3, 5;
 * docs/solution.md Section 6.2 rule 2). Pure: all time comes from inputs.
 */
import { DEFAULT_TOLERANCES, type DoorEvent, type Visit, type VisitBoundary } from "./types"

const MIN = 60_000

/** Arrival candidates start this long before the scheduled start (EARS 2). */
export const ARRIVAL_LEAD_MIN = 30
/** Late arrivals are accepted up to this long after the start, capped at the scheduled end. */
export const ARRIVAL_LATE_LIMIT_MIN = 60
/** Candidates within this gap of each other form one cluster; the earliest wins. */
export const ARRIVAL_CLUSTER_GAP_MIN = 5
/** Two pre-grace clusters further apart than this go to the Judge (EARS 3). */
export const AMBIGUOUS_CLUSTER_SEPARATION_MIN = 20
/** Judge decisions below this confidence mark the visit ambiguous (EARS 3). */
export const JUDGE_CONFIDENCE_THRESHOLD = 0.7
/** Confidence recorded for a single-cluster rule decision. */
export const RULE_SINGLE_CLUSTER_CONFIDENCE = 0.9
/** The deterministic fallback judge never claims more than this. */
export const RULE_JUDGE_MAX_CONFIDENCE = 0.85
/** Vehicle motion this soon before a candidate marks it delivery-like. */
const VEHICLE_LOOKBACK_MIN = 2
/** Minutes of distance added to a delivery-like cluster by the rule judge. */
const DELIVERY_PENALTY_MIN = 30
/** Minutes of score margin that move the rule judge's confidence from 0.5 to 1. */
const RULE_JUDGE_MARGIN_SCALE_MIN = 60

export interface ArrivalCandidate {
  at: string
  eventId: string
  kind: "ding" | "human_motion"
  /** Vehicle motion shortly before the candidate (a delivery-like pattern). */
  precededByVehicle?: boolean
}

export interface ArrivalChoice {
  scheduledStart: string
  candidates: ArrivalCandidate[]
  /** Candidate clusters (earliest first within each), when already computed. */
  clusters?: ArrivalCandidate[][]
  caregiverUsualArrivalOffsetMin?: number
}

export interface ArrivalDecision {
  at: string
  confidence: number
}

export type JudgeKind = "rule" | "jev"

export interface ArrivalJudge {
  /**
   * Recorded as the arrival's `source`. Omitted means the injected judge is
   * the Jev adapter; the deterministic fallback is always "rule".
   */
  readonly kind?: JudgeKind
  chooseArrival(choice: ArrivalChoice): ArrivalDecision | null
}

export interface ArrivalJudgment {
  judge: JudgeKind
  input: ArrivalChoice
  decision: ArrivalDecision | null
}

const byTime = (a: { at: string }, b: { at: string }): number =>
  Date.parse(a.at) - Date.parse(b.at)

interface ScoredCluster {
  representative: ArrivalCandidate
  score: number
}

function scoreClusters(choice: ArrivalChoice, groups: ArrivalCandidate[][]): ScoredCluster[] {
  const expected =
    Date.parse(choice.scheduledStart) + (choice.caregiverUsualArrivalOffsetMin ?? 0) * MIN
  return groups
    .filter((group) => group.length > 0)
    .map((group) => {
      const representative = group[0] as ArrivalCandidate
      const distanceMin = Math.abs(Date.parse(representative.at) - expected) / MIN
      const penalty = group.some((candidate) => candidate.precededByVehicle) ? DELIVERY_PENALTY_MIN : 0
      return { representative, score: distanceMin + penalty }
    })
    .sort((a, b) => a.score - b.score || byTime(a.representative, b.representative))
}

/**
 * Deterministic fallback judge, labeled "rule" in evidence. It prefers the
 * cluster nearest the expected arrival and penalizes delivery-like clusters.
 * Confidence grows with the score margin between the two best clusters, so
 * genuinely close calls fall below the 0.7 threshold and stay ambiguous.
 */
export const ruleJudge: ArrivalJudge = {
  kind: "rule",
  chooseArrival(choice) {
    const groups = choice.clusters ?? clusterCandidates(choice.candidates)
    const [best, second] = scoreClusters(choice, groups)
    if (!best) return null
    if (!second) return { at: best.representative.at, confidence: RULE_JUDGE_MAX_CONFIDENCE }
    const margin = second.score - best.score
    const confidence = Math.min(RULE_JUDGE_MAX_CONFIDENCE, 0.5 + margin / RULE_JUDGE_MARGIN_SCALE_MIN)
    return { at: best.representative.at, confidence: Math.round(confidence * 100) / 100 }
  },
}

export function isArrivalSignal(event: Pick<DoorEvent, "type" | "subType">): boolean {
  return event.type === "ding" || (event.type === "motion" && event.subType === "human")
}

function isVehicleMotion(event: DoorEvent): boolean {
  return event.type === "motion" && event.subType === "vehicle"
}

/** The arrival search range: [start - 30 min, min(start + 60 min, end)]. */
export function arrivalRange(visit: Visit): { from: number; to: number } {
  const start = Date.parse(visit.scheduledStart)
  const end = Math.max(start, Date.parse(visit.scheduledEnd))
  return { from: start - ARRIVAL_LEAD_MIN * MIN, to: Math.min(start + ARRIVAL_LATE_LIMIT_MIN * MIN, end) }
}

/** Arrival signals inside {@link arrivalRange}, oldest first (EARS 2, 3, 5). */
export function arrivalCandidates(visit: Visit, events: readonly DoorEvent[]): ArrivalCandidate[] {
  const { from, to } = arrivalRange(visit)
  const vehicles = events.filter(isVehicleMotion).map((event) => Date.parse(event.at))
  return events
    .filter((event) => isArrivalSignal(event))
    .filter((event) => {
      const at = Date.parse(event.at)
      return at >= from && at <= to
    })
    .sort((a, b) => byTime(a, b) || a.requestId.localeCompare(b.requestId))
    .map((event) => {
      const at = Date.parse(event.at)
      const precededByVehicle = vehicles.some(
        (vehicleAt) => vehicleAt <= at && at - vehicleAt <= VEHICLE_LOOKBACK_MIN * MIN
      )
      return {
        at: event.at,
        eventId: event.requestId,
        kind: event.type === "ding" ? ("ding" as const) : ("human_motion" as const),
        ...(precededByVehicle ? { precededByVehicle } : {}),
      }
    })
}

/** Chain candidates no more than `gapMin` apart into clusters, oldest first. */
export function clusterCandidates(
  candidates: readonly ArrivalCandidate[],
  gapMin: number = ARRIVAL_CLUSTER_GAP_MIN
): ArrivalCandidate[][] {
  const sorted = [...candidates].sort(byTime)
  return sorted.reduce<ArrivalCandidate[][]>((clusters, candidate) => {
    const last = clusters.at(-1)
    const tail = last?.at(-1)
    if (last && tail && Date.parse(candidate.at) - Date.parse(tail.at) <= gapMin * MIN) {
      return [...clusters.slice(0, -1), [...last, candidate]]
    }
    return [...clusters, [candidate]]
  }, [])
}

export type ArrivalChoiceResult =
  | { outcome: "chosen"; arrival: VisitBoundary; method: JudgeKind; judgment?: ArrivalJudgment }
  | { outcome: "ambiguous"; judgment?: ArrivalJudgment }
  | { outcome: "none" }

export interface ChooseArrivalContext {
  judge?: ArrivalJudge
  caregiverUsualArrivalOffsetMin?: number
  /** Agency grace in minutes; clusters are compared only before start + grace. */
  graceMin?: number
}

function ruleChoice(candidate: ArrivalCandidate): ArrivalChoiceResult {
  return {
    outcome: "chosen",
    method: "rule",
    arrival: {
      at: candidate.at,
      eventId: candidate.eventId,
      source: "rule",
      confidence: RULE_SINGLE_CLUSTER_CONFIDENCE,
    },
  }
}

function spanMin(clusters: readonly ArrivalCandidate[][]): number {
  const first = clusters[0]?.[0]
  const last = clusters.at(-1)?.[0]
  if (!first || !last) return 0
  return (Date.parse(last.at) - Date.parse(first.at)) / MIN
}

/**
 * Pick the arrival. Candidates up to start + grace are clustered (5 minute
 * chains, earliest wins); a single cluster, or clusters no more than 20
 * minutes apart, resolve by rule to the earliest. Clusters further apart go
 * to the Judge, and a decision below 0.7 confidence is ambiguous. With no
 * pre-grace candidate the first later candidate is a late arrival.
 */
export function chooseArrival(
  visit: Visit,
  candidates: readonly ArrivalCandidate[],
  context: ChooseArrivalContext = {}
): ArrivalChoiceResult {
  const graceEnd =
    Date.parse(visit.scheduledStart) + (context.graceMin ?? DEFAULT_TOLERANCES.graceMin) * MIN
  const sorted = [...candidates].sort(byTime)
  const pre = sorted.filter((candidate) => Date.parse(candidate.at) <= graceEnd)
  const firstLate = sorted.find((candidate) => Date.parse(candidate.at) > graceEnd)
  if (pre.length === 0) return firstLate ? ruleChoice(firstLate) : { outcome: "none" }
  const clusters = clusterCandidates(pre)
  const earliest = (clusters[0] as ArrivalCandidate[])[0] as ArrivalCandidate
  if (clusters.length === 1 || spanMin(clusters) <= AMBIGUOUS_CLUSTER_SEPARATION_MIN) {
    return ruleChoice(earliest)
  }
  return judgeClusters(visit, clusters, context)
}

function judgeClusters(
  visit: Visit,
  clusters: ArrivalCandidate[][],
  context: ChooseArrivalContext
): ArrivalChoiceResult {
  const judge = context.judge ?? ruleJudge
  const kind: JudgeKind = judge.kind ?? "jev"
  const input: ArrivalChoice = {
    scheduledStart: visit.scheduledStart,
    candidates: clusters.flat(),
    clusters,
    ...(context.caregiverUsualArrivalOffsetMin === undefined
      ? {}
      : { caregiverUsualArrivalOffsetMin: context.caregiverUsualArrivalOffsetMin }),
  }
  const decision = judge.chooseArrival(input)
  const judgment: ArrivalJudgment = { judge: kind, input, decision }
  if (!decision || decision.confidence < JUDGE_CONFIDENCE_THRESHOLD) {
    return { outcome: "ambiguous", judgment }
  }
  const cluster = clusters.find((group) => group.some((candidate) => candidate.at === decision.at))
  const chosen = cluster?.[0]
  if (!chosen) return { outcome: "ambiguous", judgment }
  return {
    outcome: "chosen",
    method: kind,
    judgment,
    arrival: { at: chosen.at, eventId: chosen.eventId, source: kind, confidence: decision.confidence },
  }
}
