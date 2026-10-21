import { createRng, jitterMs, type Rng } from "./jitter"
import {
  TWO_WEEKS_CLIENTS,
  TWO_WEEKS_DAY_MS,
  TWO_WEEKS_EVV_EXCEPTIONS,
  TWO_WEEKS_TIME_ZONE,
  type PrimitiveKind,
  type TwoWeeksClient,
  type TwoWeeksVisit,
} from "./scenarios"
import { localDateKey, zonedWallTimeToEpoch } from "./time-zone"

/**
 * Ground-truth planner for the two-week replay. Pure and seeded: it decides
 * every visit's local scheduled time, the true (jittered) arrival and
 * departure, occasional mid-visit motion that is not an arrival signal
 * (animal or other motion, so the engine's outcome is unchanged), and the
 * intended EVV clock-in so the demo can generate EVV data independently of
 * the door record. The outcome counts are fixed by the scenario data.
 */

const MIN = 60_000
export const TWO_WEEKS_VISIT_DURATION_MS = 2 * 60 * MIN
/** The unobservable scenario's device drops exactly 30 minutes in. */
export const UNOBSERVABLE_OFFLINE_AFTER_MS = 30 * MIN
/** The outage ends (device_online or integration_added) an hour after the scheduled end. */
export const OUTAGE_RESTORED_AFTER_END_MS = 60 * MIN
/** The emulated device check reports TAKE encryption this long around an encrypted visit. */
export const ENCRYPTION_REPORTED_MARGIN_MS = 60 * MIN

export type EvvBehavior = "normal" | "contradicted" | "missing" | "none"

export interface EvvPlan {
  readonly behavior: EvvBehavior
  /** Intended EVV clock-in (epoch ms); null when missing or none. */
  readonly clockInAt: number | null
  readonly clockOutAt: number | null
}

export interface PlannedEvent {
  readonly kind: PrimitiveKind
  readonly at: number
}

export interface TwoWeeksVisitPlan extends TwoWeeksVisit {
  readonly clientId: string
  readonly deviceId: string
  readonly accountId: string
  readonly caregiver: string
  readonly scheduledStartAt: number
  readonly scheduledEndAt: number
  /** Intended engine outcome for this visit (see EXPECTED_BY_VISIT). */
  readonly expected: string
  readonly timeZone: string
  /** Local calendar date of the scheduled start (YYYY-MM-DD). */
  readonly localDate: string
  /** True arrival (the doorbell press), or null for a no-show. */
  readonly arrivalAt: number | null
  /** True departure motion, or null when none is observed. */
  readonly departureAt: number | null
  /** Every door event emitted for this visit, oldest first. */
  readonly events: readonly PlannedEvent[]
  readonly evv: EvvPlan
}

export interface TwoWeeksPlanOptions {
  readonly startAt: number
  readonly timeZone?: string
  readonly seed?: string
}

/**
 * The engine's actual outcome per scripted visit kind. Note `double`: the
 * vehicle motion is not an arrival signal, so the ding forms a single
 * cluster, the arrival is chosen deterministically (never ambiguous), and
 * the trailing human motion records the departure, a completed visit.
 */
export const EXPECTED_BY_VISIT: Readonly<Record<TwoWeeksVisit["kind"], string>> = {
  on_time: "arrived_on_time",
  late: "arrived_late",
  no_show: "no_show",
  early: "early_departure",
  unobservable: "unobservable",
  double: "completed",
}

interface DoorTruth {
  readonly arrivalAt: number | null
  readonly departureAt: number | null
  readonly events: readonly PlannedEvent[]
}

/** Arrival jitter keeps on-time arrivals inside the 15 minute grace. */
const onTimeArrival = (rng: Rng, start: number) => start + jitterMs(rng, -6, 9)
/** Departure jitter keeps full visits outside the 10 minute early cutoff. */
const fullDeparture = (rng: Rng, end: number) => end + jitterMs(rng, -4, 8)

/**
 * The blind spot starts 30 minutes in and is restored an hour after the
 * scheduled end, so the next visit for the client is observable again. An
 * encrypted device keeps emitting events (the device check reports the
 * encryption); the other outages cut the door off until restored.
 */
const unobservableTruth = (visit: TwoWeeksVisit, start: number, end: number, rng: Rng): DoorTruth => {
  const arrivalAt = onTimeArrival(rng, start)
  const ding: PlannedEvent = { kind: "ding", at: arrivalAt }
  const outage = visit.outage ?? "device_offline"
  if (outage === "encrypted_device") {
    const departureAt = fullDeparture(rng, end)
    return { arrivalAt, departureAt, events: [ding, { kind: "motion_human", at: departureAt }] }
  }
  const [lost, restored]: readonly [PrimitiveKind, PrimitiveKind] =
    outage === "integration_removed"
      ? ["integration_removed", "integration_added"]
      : ["device_offline", "device_online"]
  const events: PlannedEvent[] = [
    ding,
    { kind: lost, at: start + UNOBSERVABLE_OFFLINE_AFTER_MS },
    { kind: restored, at: end + OUTAGE_RESTORED_AFTER_END_MS },
  ]
  return { arrivalAt, departureAt: null, events }
}

const doorTruth = (visit: TwoWeeksVisit, start: number, rng: Rng): DoorTruth => {
  const end = start + TWO_WEEKS_VISIT_DURATION_MS
  switch (visit.kind) {
    case "no_show":
      return { arrivalAt: null, departureAt: null, events: [] }
    case "unobservable":
      return unobservableTruth(visit, start, end, rng)
    case "late": {
      const lateMs = (visit.lateMin ?? 20) * MIN
      const arrivalAt = start + lateMs + jitterMs(rng, 0, 3)
      const departureAt = end + lateMs + jitterMs(rng, -3, 6)
      return { arrivalAt, departureAt, events: [{ kind: "ding", at: arrivalAt }, { kind: "motion_human", at: departureAt }] }
    }
    case "early": {
      const arrivalAt = onTimeArrival(rng, start)
      const departureAt = start + (visit.leaveAtMin ?? 30) * MIN + jitterMs(rng, -3, 3)
      return { arrivalAt, departureAt, events: [{ kind: "ding", at: arrivalAt }, { kind: "motion_human", at: departureAt }] }
    }
    case "on_time":
    case "double": {
      const arrivalAt = onTimeArrival(rng, start)
      const departureAt = fullDeparture(rng, end)
      const vehicle: PlannedEvent[] =
        visit.kind === "double" ? [{ kind: "motion_vehicle", at: arrivalAt + 15_000 }] : []
      return {
        arrivalAt,
        departureAt,
        events: [{ kind: "ding", at: arrivalAt }, ...vehicle, { kind: "motion_human", at: departureAt }],
      }
    }
  }
}

/**
 * Occasional mid-visit motion (about one visit in four): a pet or other
 * motion at the front door. Not an arrival signal, so arrival, departure,
 * and every outcome stay exactly as planned.
 */
const withMidVisitMotion = (truth: DoorTruth, visit: TwoWeeksVisit, rng: Rng): DoorTruth => {
  const eligible = visit.kind === "on_time" || visit.kind === "late" || visit.kind === "double"
  const roll = rng()
  if (!eligible || truth.arrivalAt === null || roll >= 0.25) return truth
  const at = truth.arrivalAt + jitterMs(rng, 35, 80)
  const kind: PrimitiveKind = rng() < 0.5 ? "motion_animal" : "motion_other"
  const events = [...truth.events, { kind, at }].sort((a, b) => a.at - b.at)
  return { ...truth, events }
}

const evvPlan = (
  behavior: EvvBehavior,
  truth: DoorTruth,
  scheduledEndAt: number,
  rng: Rng
): EvvPlan => {
  if (behavior === "none" || behavior === "missing" || truth.arrivalAt === null) {
    return { behavior, clockInAt: null, clockOutAt: null }
  }
  const outAnchor = truth.departureAt ?? scheduledEndAt
  const clockOutAt = outAnchor + jitterMs(rng, -4, 4)
  // Contradicted: the clock-in claims presence 38 to 50 minutes before the
  // door saw anyone (beyond the 30 minute reconciliation band).
  const clockInAt =
    behavior === "contradicted"
      ? truth.arrivalAt - jitterMs(rng, 38, 50)
      : truth.arrivalAt + jitterMs(rng, -4, 4)
  return { behavior, clockInAt, clockOutAt }
}

const evvBehaviorFor = (
  client: TwoWeeksClient,
  visit: TwoWeeksVisit,
  onTimeOrdinal: number
): EvvBehavior => {
  if (visit.kind === "no_show") return "none"
  if (visit.kind !== "on_time") return "normal"
  const exceptions = TWO_WEEKS_EVV_EXCEPTIONS[client.clientId]
  if (exceptions?.contradicted.includes(onTimeOrdinal)) return "contradicted"
  if (exceptions?.missing.includes(onTimeOrdinal)) return "missing"
  return "normal"
}

const calendarDate = (epochMs: number) => {
  const date = new Date(epochMs)
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
}

const planClient = (client: TwoWeeksClient, options: Required<TwoWeeksPlanOptions>): TwoWeeksVisitPlan[] => {
  let onTimeOrdinal = 0
  return client.visits.map((visit, index) => {
    const rng = createRng(`${options.seed}:${client.clientId}:${index}`)
    const date = calendarDate(options.startAt + visit.day * TWO_WEEKS_DAY_MS)
    const scheduledStartAt = zonedWallTimeToEpoch(date, visit.hour, visit.minute, options.timeZone)
    const scheduledEndAt = scheduledStartAt + TWO_WEEKS_VISIT_DURATION_MS
    const truth = withMidVisitMotion(doorTruth(visit, scheduledStartAt, rng), visit, rng)
    const behavior = evvBehaviorFor(client, visit, onTimeOrdinal)
    if (visit.kind === "on_time") onTimeOrdinal += 1
    return {
      ...visit,
      clientId: client.clientId,
      deviceId: client.deviceId,
      accountId: client.accountId,
      caregiver: client.caregivers[index % client.caregivers.length]!,
      scheduledStartAt,
      scheduledEndAt,
      expected: EXPECTED_BY_VISIT[visit.kind],
      timeZone: options.timeZone,
      localDate: localDateKey(scheduledStartAt, options.timeZone),
      arrivalAt: truth.arrivalAt,
      departureAt: truth.departureAt,
      events: truth.events,
      evv: evvPlan(behavior, truth, scheduledEndAt, rng),
    }
  })
}

/** What the emulated Ring device check reports for a client at an instant. */
export interface EmulatedDeviceCheck {
  readonly encryptionState: "clear" | "take"
}

/**
 * The emulated device check (Ring `GET /v1/devices`): the encrypted-device
 * visit's front door reports TAKE encryption from an hour before its
 * scheduled start to an hour after its end; every other check is clear.
 */
export const emulatedDeviceCheck = (
  plans: readonly TwoWeeksVisitPlan[],
  clientId: string,
  at: number
): EmulatedDeviceCheck => {
  const encrypted = plans.some(
    (plan) =>
      plan.clientId === clientId &&
      plan.outage === "encrypted_device" &&
      at >= plan.scheduledStartAt - ENCRYPTION_REPORTED_MARGIN_MS &&
      at <= plan.scheduledEndAt + ENCRYPTION_REPORTED_MARGIN_MS
  )
  return { encryptionState: encrypted ? "take" : "clear" }
}

/** Plans all 84 visits. `startAt` is 00:00 UTC of day 0's calendar date. */
export const planTwoWeeks = (options: TwoWeeksPlanOptions): readonly TwoWeeksVisitPlan[] => {
  if (!Number.isInteger(options.startAt) || options.startAt <= 0) {
    throw new RangeError("twoWeeks: startAt must be a positive epoch ms integer")
  }
  const resolved: Required<TwoWeeksPlanOptions> = {
    startAt: options.startAt,
    timeZone: options.timeZone ?? TWO_WEEKS_TIME_ZONE,
    seed: options.seed ?? "visitproof-two-weeks",
  }
  return TWO_WEEKS_CLIENTS.flatMap((client) => planClient(client, resolved))
}
