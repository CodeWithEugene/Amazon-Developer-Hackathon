/**
 * Observability overlay (EARS rule 8; docs/solution.md Section 4 principle
 * 4). A visit is unobservable when, for any part of its presence window
 * [start - 30 min, end], the front door was offline, motion recording was
 * off, no motion zone existed, the device was encrypted, or the integration
 * was paused or removed. Lifecycle events in the client's own stream
 * (device_offline, device_online, integration_removed, integration_added)
 * give the history; client and device state give the present, and are
 * applied only while the window is open.
 */
import { ARRIVAL_LEAD_MIN } from "./arrival"
import type {
  Consent,
  Device,
  DoorEvent,
  EncryptionState,
  IntegrationStatus,
  Observability,
  ObservabilityReason,
  RingLinkStatus,
  Visit,
} from "./types"
import { visitWindow } from "./window"

const MIN = 60_000

export interface ObservabilityInput {
  /** Current devices for the client; omit when unknown (no device checks run). */
  devices?: readonly Device[]
  integrationStatus?: IntegrationStatus
  encryptionState?: EncryptionState
  ringLinkStatus?: RingLinkStatus
  consent?: Consent
  /** The front door was offline for part of the window (from lifecycle events). */
  offlineDuringWindow?: boolean
  /** The integration was removed for part of the window (from lifecycle events). */
  integrationRemovedDuringWindow?: boolean
}

function deviceReasons(devices: readonly Device[]): ObservabilityReason[] {
  const frontDoors = devices.filter((device) => device.role === "front_door")
  if (frontDoors.length === 0) return ["no_front_door_device"]
  return frontDoors.flatMap((device) => [
    ...(device.online ? [] : ["device_offline" as const]),
    ...(device.motionRecordingEnabled ? [] : ["motion_recording_off" as const]),
    ...(device.hasMotionZone ? [] : ["no_motion_zone" as const]),
  ])
}

/** Reasons the door cannot be trusted for a window (EARS rule 8). */
export function assessObservability(input: ObservabilityInput): Observability {
  const reasons: ObservabilityReason[] = [
    ...(input.devices ? deviceReasons(input.devices) : []),
    ...(input.offlineDuringWindow ? ["device_offline" as const] : []),
    // TAKE-encrypted and E2EE devices both degrade to unobservable
    // (docs/solution.md Section 4): events may flow, but the door record
    // cannot be trusted as evidence either way.
    ...(input.encryptionState === "e2ee" || input.encryptionState === "take"
      ? ["encrypted_device" as const]
      : []),
    ...(input.integrationStatus === "removed" || input.integrationRemovedDuringWindow
      ? ["integration_removed" as const]
      : []),
    ...(input.ringLinkStatus === "paused" ? ["integration_paused" as const] : []),
    ...(input.ringLinkStatus === "removed" ? ["consent_withdrawn" as const] : []),
    ...(input.consent && !input.consent.shareWithAgency ? ["consent_withdrawn" as const] : []),
  ]
  const unique = [...new Set(reasons)]
  return { state: unique.length > 0 ? "unobservable" : "observable", reasons: unique }
}

/** Current device and integration state for one client. */
export interface DeviceStates {
  devices?: readonly Device[]
  integrationStatus?: IntegrationStatus
  encryptionState?: EncryptionState
}

export interface VisitObservabilityInput {
  /** All door events for the visit's client (lifecycle events included). */
  events: readonly DoorEvent[]
  now: Date
  ringLinkStatus?: RingLinkStatus
  deviceStates?: DeviceStates
}

/**
 * Events that change the lifecycle state. A ding or motion from the device
 * is itself evidence the device is online, even when Ring's
 * device_online delivery is missing.
 */
const LIFECYCLE_TYPES: ReadonlySet<DoorEvent["type"]> = new Set([
  "device_offline",
  "device_online",
  "integration_removed",
  "integration_added",
  "ding",
  "motion",
])

interface LifecycleFlags {
  offline: boolean
  removed: boolean
}

function applyLifecycle(state: LifecycleFlags, event: DoorEvent): LifecycleFlags {
  switch (event.type) {
    case "device_offline":
      return { ...state, offline: true }
    case "device_online":
    case "ding":
    case "motion":
      return state.offline ? { ...state, offline: false } : state
    case "integration_removed":
      return { ...state, removed: true }
    case "integration_added":
      return { ...state, removed: false }
    default:
      return state
  }
}

function isFrontDoorEvent(event: DoorEvent, devices: readonly Device[] | undefined): boolean {
  if (event.type === "integration_removed" || event.type === "integration_added") return true
  if (!devices || !event.deviceId) return true
  return devices.some((device) => device.role === "front_door" && device.ringDeviceId === event.deviceId)
}

/** Whether the door was offline or the integration removed at any point in [from, to]. */
export function lifecycleDuring(
  events: readonly DoorEvent[],
  from: number,
  to: number,
  devices?: readonly Device[]
): LifecycleFlags {
  const lifecycle = events
    .filter((event) => LIFECYCLE_TYPES.has(event.type) && isFrontDoorEvent(event, devices))
    .filter((event) => Date.parse(event.at) <= to)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.requestId.localeCompare(b.requestId))
  let state: LifecycleFlags = { offline: false, removed: false }
  let seen: LifecycleFlags = { offline: false, removed: false }
  for (const event of lifecycle) {
    state = applyLifecycle(state, event)
    if (Date.parse(event.at) >= from) {
      seen = { offline: seen.offline || state.offline, removed: seen.removed || state.removed }
    }
  }
  const before = lifecycle.filter((event) => Date.parse(event.at) < from).reduce(applyLifecycle, {
    offline: false,
    removed: false,
  })
  return { offline: seen.offline || before.offline, removed: seen.removed || before.removed }
}

/**
 * The visit's observability at `now`: lifecycle history over the part of the
 * presence window already elapsed, plus current client and device state
 * while the window is open, merged with any overlay already on the visit
 * (unobservable is sticky, reasons accumulate).
 */
export function assessVisitObservability(visit: Visit, input: VisitObservabilityInput): Observability {
  const window = visitWindow(visit)
  const from = window.start - ARRIVAL_LEAD_MIN * MIN
  const nowMs = input.now.getTime()
  if (nowMs < from) return visit.observability
  const to = Math.min(window.end, nowMs)
  const devices = input.deviceStates?.devices
  const lifecycle = lifecycleDuring(input.events, from, to, devices)
  const open = nowMs <= window.end
  const assessed = assessObservability({
    offlineDuringWindow: lifecycle.offline,
    integrationRemovedDuringWindow: lifecycle.removed,
    ...(open ? { ...input.deviceStates, ringLinkStatus: input.ringLinkStatus } : {}),
  })
  return mergeObservability(visit.observability, assessed)
}

/** Union two assessments; unobservable wins and reasons accumulate. */
export function mergeObservability(previous: Observability, next: Observability): Observability {
  const reasons = [...new Set([...previous.reasons, ...next.reasons])]
  const rank = { observable: 0, degraded: 1, unobservable: 2 } as const
  const state = rank[next.state] > rank[previous.state] ? next.state : previous.state
  if (state === previous.state && reasons.length === previous.reasons.length) return previous
  return { state, reasons }
}
