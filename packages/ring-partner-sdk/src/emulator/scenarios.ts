/**
 * Emulator scenario fixtures (data only). Every scenario is expressed as
 * offsets in milliseconds from a visit's scheduled start so the same script
 * can be replayed at any base time. `two_weeks` is the scripted demo dataset
 * for the three demo clients (build.md Section 15): 84 visits made of 62
 * on-time, 9 late, 4 no-show, 5 early departures, 3 unobservable, and 1
 * ambiguous double visitor.
 */

export type PrimitiveKind =
  | "ding"
  | "motion_human"
  | "motion_vehicle"
  | "motion_animal"
  | "motion_other"
  | "device_offline"
  | "device_online"
  | "integration_removed"
  | "integration_added"
  | "subscription_deactivated"

export interface ScenarioStep {
  readonly offsetMs: number
  readonly kind: PrimitiveKind
}

/** Single-event primitives named per the build spec (aliases in parentheses). */
export type ScenarioName =
  | "ding"
  | "motion"
  | "arrival"
  | "departure"
  | "on_time"
  | "late_arrival"
  | "no_show"
  | "early_departure"
  | "double_visitor"
  | "device_offline_mid_visit"
  | "encrypted_device"
  | "integration_removed"

/** Task-level aliases mapped onto the canonical scenario names. */
export const SCENARIO_ALIASES: Readonly<Record<string, ScenarioName>> = {
  missed: "no_show",
  no_show_day: "no_show",
  multiple_caregivers: "double_visitor",
  unobservable: "device_offline_mid_visit",
}

const MIN = 60_000

export interface ScenarioScript {
  readonly name: ScenarioName
  readonly description: string
  readonly steps: readonly ScenarioStep[]
  /** Scheduled visit length the step offsets assume. */
  readonly visitDurationMs: number
}

export const SCENARIOS: Readonly<Record<ScenarioName, ScenarioScript>> = {
  ding: {
    name: "ding",
    description: "A single doorbell press at the scheduled start.",
    steps: [{ offsetMs: 0, kind: "ding" }],
    visitDurationMs: 2 * 60 * MIN,
  },
  motion: {
    name: "motion",
    description: "A single human motion detection at the scheduled start.",
    steps: [{ offsetMs: 0, kind: "motion_human" }],
    visitDurationMs: 2 * 60 * MIN,
  },
  arrival: {
    name: "arrival",
    description: "Doorbell press then human motion: a clean arrival.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 30_000, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  departure: {
    name: "departure",
    description: "Human motion at the end of the window: a departure.",
    steps: [{ offsetMs: 2 * 60 * MIN, kind: "motion_human" }],
    visitDurationMs: 2 * 60 * MIN,
  },
  on_time: {
    name: "on_time",
    description: "Arrival within grace, departure after the full window.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 30_000, kind: "motion_human" },
      { offsetMs: 2 * 60 * MIN + 5_000, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  late_arrival: {
    name: "late_arrival",
    description: "Arrival 20 minutes after the scheduled start (past the 15 minute grace).",
    steps: [
      { offsetMs: 20 * MIN, kind: "ding" },
      { offsetMs: 20 * MIN + 30_000, kind: "motion_human" },
      { offsetMs: 20 * MIN + 2 * 60 * MIN, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  no_show: {
    name: "no_show",
    description: "No events at all during the window: the caregiver never came.",
    steps: [],
    visitDurationMs: 2 * 60 * MIN,
  },
  early_departure: {
    name: "early_departure",
    description: "On-time arrival but a departure 30 minutes into a 2 hour visit.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 30_000, kind: "motion_human" },
      { offsetMs: 30 * MIN, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  double_visitor: {
    name: "double_visitor",
    description: "A delivery (vehicle motion) precedes the caregiver (human motion): ambiguous arrival.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 15_000, kind: "motion_vehicle" },
      { offsetMs: 45_000, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  device_offline_mid_visit: {
    name: "device_offline_mid_visit",
    description: "Device goes offline 30 minutes in: no departure is ever observed.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 30_000, kind: "motion_human" },
      { offsetMs: 30 * MIN, kind: "device_offline" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  encrypted_device: {
    name: "encrypted_device",
    description: "Events arrive but the device is TAKE-encrypted, so media is unusable.",
    steps: [
      { offsetMs: 0, kind: "ding" },
      { offsetMs: 30_000, kind: "motion_human" },
      { offsetMs: 2 * 60 * MIN + 5_000, kind: "motion_human" },
    ],
    visitDurationMs: 2 * 60 * MIN,
  },
  integration_removed: {
    name: "integration_removed",
    description: "The family removes the integration: events stop arriving.",
    steps: [{ offsetMs: 0, kind: "integration_removed" }],
    visitDurationMs: 0,
  },
}

// ---------------------------------------------------------------------------
// Two-week replay dataset (three clients, four caregivers, 84 visits)
// ---------------------------------------------------------------------------

export type TwoWeeksVisitKind =
  | "on_time"
  | "late"
  | "no_show"
  | "early"
  | "unobservable"
  | "double"

/**
 * Why an unobservable visit cannot be trusted: the front door went offline,
 * the device is TAKE-encrypted (reported by the device check, events still
 * flow), or the family removed the integration for part of the window.
 */
export type TwoWeeksOutage = "device_offline" | "encrypted_device" | "integration_removed"

export interface TwoWeeksVisit {
  /** Day index within the 14 day window (0 = first day). */
  readonly day: number
  /** Local wall-clock scheduled start in the replay time zone (America/New_York). */
  readonly hour: number
  readonly minute: number
  readonly kind: TwoWeeksVisitKind
  /** Minutes past the scheduled start the caregiver arrives (late visits). */
  readonly lateMin?: number
  /** Minutes into the visit the caregiver leaves (early departures). */
  readonly leaveAtMin?: number
  /** Unobservable visits only: the cause of the blind spot. */
  readonly outage?: TwoWeeksOutage
}

export interface TwoWeeksClient {
  readonly clientId: string
  readonly clientName: string
  readonly accountId: string
  readonly deviceId: string
  readonly caregivers: readonly string[]
  readonly visits: readonly TwoWeeksVisit[]
}

/** Local time zone of the demo agency; visit slots are wall-clock times here. */
export const TWO_WEEKS_TIME_ZONE = "America/New_York"

type Slot = readonly [hour: number, minute: number]

/**
 * First and second visit slot per client, per day, as New York wall time:
 * Okoro 8:00 AM and 4:00 PM, Nakamura 12:00 PM and 6:00 PM, Alvarez 9:30 AM
 * and 2:00 PM. Slots of one client are at least three hours apart so one
 * visit's departure never falls inside the next visit's arrival window.
 */
const DAILY_SLOTS: Readonly<Record<string, readonly [Slot, Slot]>> = {
  Okoro: [
    [8, 0],
    [16, 0],
  ],
  Nakamura: [
    [12, 0],
    [18, 0],
  ],
  Alvarez: [
    [9, 30],
    [14, 0],
  ],
}

const visits = (
  client: string,
  rows: readonly (readonly [number, TwoWeeksVisitKind, number?, number?, TwoWeeksOutage?])[]
): readonly TwoWeeksVisit[] =>
  rows.map(([dayIndex, kind, lateMin, leaveAtMin, outage]) => {
    const [first, second] = DAILY_SLOTS[client]!
    const [hour, minute] = dayIndex % 2 === 0 ? first : second
    return {
      day: Math.floor(dayIndex / 2),
      hour,
      minute,
      kind,
      ...(lateMin === undefined ? {} : { lateMin }),
      ...(leaveAtMin === undefined ? {} : { leaveAtMin }),
      ...(outage === undefined ? {} : { outage }),
    }
  })

// Okoro: 28 visits = 21 on-time, 3 late, 1 no-show, 2 early, 1 unobservable
const OKORO: readonly TwoWeeksVisit[] = visits("Okoro", [
  [0, "on_time"], [1, "on_time"], [2, "on_time"], [3, "late", 22], [4, "on_time"],
  [5, "on_time"], [6, "on_time"], [7, "on_time"], [8, "early", undefined, 35], [9, "on_time"],
  [10, "on_time"], [11, "late", 18], [12, "on_time"], [13, "on_time"], [14, "on_time"],
  [15, "on_time"], [16, "no_show"], [17, "on_time"], [18, "on_time"], [19, "on_time"],
  [20, "late", 25], [21, "on_time"], [22, "on_time"], [23, "on_time"], [24, "on_time"],
  [25, "on_time"], [26, "unobservable", undefined, undefined, "device_offline"], [27, "early", undefined, 40],
])

// Nakamura: 28 visits = 20 on-time, 4 late, 2 no-show, 1 early, 1 unobservable
const NAKAMURA: readonly TwoWeeksVisit[] = visits("Nakamura", [
  [0, "on_time"], [1, "on_time"], [2, "late", 20], [3, "on_time"], [4, "on_time"],
  [5, "on_time"], [6, "on_time"], [7, "early", undefined, 30], [8, "on_time"], [9, "on_time"],
  [10, "late", 17], [11, "on_time"], [12, "on_time"], [13, "no_show"], [14, "on_time"],
  [15, "on_time"], [16, "on_time"], [17, "on_time"], [18, "unobservable", undefined, undefined, "encrypted_device"], [19, "on_time"],
  [20, "on_time"], [21, "late", 30], [22, "on_time"], [23, "on_time"], [24, "on_time"],
  [25, "late", 19], [26, "on_time"], [27, "no_show"],
])

// Alvarez: 28 visits = 21 on-time, 2 late, 1 no-show, 2 early, 1 unobservable, 1 double
const ALVAREZ: readonly TwoWeeksVisit[] = visits("Alvarez", [
  [0, "on_time"], [1, "on_time"], [2, "on_time"], [3, "on_time"], [4, "double"],
  [5, "on_time"], [6, "late", 24], [7, "on_time"], [8, "on_time"], [9, "on_time"],
  [10, "on_time"], [11, "on_time"], [12, "no_show"], [13, "on_time"], [14, "on_time"],
  [15, "early", undefined, 28], [16, "on_time"], [17, "on_time"], [18, "on_time"],
  [19, "on_time"], [20, "unobservable", undefined, undefined, "integration_removed"], [21, "on_time"], [22, "on_time"], [23, "late", 21],
  [24, "on_time"], [25, "on_time"], [26, "on_time"], [27, "early", undefined, 33],
])

export const TWO_WEEKS_CLIENTS: readonly TwoWeeksClient[] = [
  {
    clientId: "cli_okoro",
    clientName: "Okoro",
    accountId: "ava1.ring.account.okoro",
    deviceId: "emu_dev_okoro_front_door",
    caregivers: ["cg_amara", "cg_daniel"],
    visits: OKORO,
  },
  {
    clientId: "cli_nakamura",
    clientName: "Nakamura",
    accountId: "ava1.ring.account.nakamura",
    deviceId: "emu_dev_nakamura_front_door",
    caregivers: ["cg_yuki", "cg_priya"],
    visits: NAKAMURA,
  },
  {
    clientId: "cli_alvarez",
    clientName: "Alvarez",
    accountId: "ava1.ring.account.alvarez",
    deviceId: "emu_dev_alvarez_front_door",
    caregivers: ["cg_marisol", "cg_ana"],
    visits: ALVAREZ,
  },
]

/**
 * Intended EVV clock-in behavior per client, by ordinal among that client's
 * on-time visits: 6 contradicted and 8 missing clock-ins across the three
 * clients (docs/build.md Section 15). Every other visit the caregiver
 * attended gets a normal clock-in with independent jitter; no-shows get none.
 */
export const TWO_WEEKS_EVV_EXCEPTIONS: Readonly<
  Record<string, { readonly contradicted: readonly number[]; readonly missing: readonly number[] }>
> = {
  cli_okoro: { contradicted: [3, 14], missing: [5, 11, 18] },
  cli_nakamura: { contradicted: [2, 13], missing: [6, 12, 17] },
  cli_alvarez: { contradicted: [4, 15], missing: [7, 16] },
}

/** Milliseconds per day; day N is the UTC calendar date of `startAt + N days`. */
export const TWO_WEEKS_DAY_MS = 24 * 60 * 60 * 1000
export const TWO_WEEKS_DAYS = 14
