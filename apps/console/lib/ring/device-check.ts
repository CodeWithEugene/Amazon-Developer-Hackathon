import {
  DEVICE_RESOURCE_TYPES,
  type DeviceListDocument,
  type DeviceResource,
  type IncludedResource,
} from "@visitproof/ring-partner-sdk"

import { DEFAULT_TIME_ZONE, formatLocalDateTime, zoneAbbreviation } from "../time"

/**
 * Device Check (docs/build.md Section 5.3): a checklist per shared device
 * from `GET /v1/devices?include=status,capabilities,configurations,location`,
 * mapped from the field names Ring really returns (verified against the
 * Ring Playground on 22 October 2026). Every required item that is not
 * passing explains what is wrong, why it matters, and where to change it in
 * the Ring app, because VisitProof cannot change Ring settings itself.
 * Human detection is informational: Ring's capabilities do not report
 * person detection, so VisitProof learns it from motion events instead.
 * Copy is plain, dash free, sentence case.
 */

export type CheckState = "pass" | "fail" | "unknown" | "info"

export interface CheckItem {
  readonly id: "online" | "motion_recording" | "motion_zone" | "encryption_known" | "human_detection"
  readonly title: string
  readonly state: CheckState
  /** Required items count toward "N of M required checks passing". */
  readonly required: boolean
  /** What VisitProof observed (shown for every state). */
  readonly observed: string
  readonly whyItMatters: string
  /** Where to change it in the Ring app (shown when not passing). */
  readonly whereToChange: string
}

export interface DeviceCheck {
  readonly deviceId: string
  readonly name: string
  readonly kind: string | undefined
  readonly batteryPowered: boolean | undefined
  readonly location: string | undefined
  readonly items: readonly CheckItem[]
  /** Required items passing. */
  readonly passed: number
  /** Required items in total (informational items are excluded). */
  readonly required: number
}

export interface DeviceCheckOptions {
  /** Time zone for the "last reported" time; defaults to the agency zone. */
  readonly timeZone?: string
}

type Attributes = Readonly<Record<string, unknown>>

const record = (value: unknown): Attributes | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Attributes) : undefined

const includedFor = (
  device: DeviceResource,
  included: readonly IncludedResource[],
  type: string,
  relationship: string
): Attributes | undefined => {
  const related = device.relationships?.[relationship]?.data
  const relatedId = related && !Array.isArray(related) ? related.id : undefined
  const match =
    included.find((resource) => resource.type === type && resource.id === relatedId) ??
    included.find((resource) => resource.type === type && resource.id === device.id)
  return record((match as { attributes?: unknown } | undefined)?.attributes)
}

const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)
const stateOf = (value: boolean | undefined): CheckState =>
  value === undefined ? "unknown" : value ? "pass" : "fail"

const reportedText = (reportedAt: unknown, timeZone: string): string => {
  if (typeof reportedAt !== "string" || Number.isNaN(Date.parse(reportedAt))) return ""
  return ` Last reported by Ring: ${formatLocalDateTime(reportedAt, timeZone)} ${zoneAbbreviation(reportedAt, timeZone)}.`
}

const onlineItem = (status: Attributes | undefined, timeZone: string): CheckItem => {
  const online = bool(status?.online)
  const observed =
    online === undefined ? "Ring did not report the connection state." : online ? "The doorbell is connected." : "The doorbell is offline."
  return {
    id: "online",
    title: "Online",
    state: stateOf(online),
    required: true,
    observed: `${observed}${online === undefined ? "" : reportedText(status?.reported_at, timeZone)}`,
    whyItMatters: "VisitProof can only see arrivals and departures while the doorbell is connected.",
    whereToChange: "In the Ring app, open the doorbell, then Device Health, and check the Wi-Fi signal and power or battery.",
  }
}

const motionRecordingItem = (motion: Attributes | undefined): CheckItem => {
  const setting = typeof motion?.enabled === "string" ? motion.enabled : undefined
  const enabled = setting === "on" ? true : setting === "off" ? false : undefined
  return {
    id: "motion_recording",
    title: "Motion Recording On",
    state: stateOf(enabled),
    required: true,
    observed: enabled === undefined ? "Ring did not report the motion recording setting." : enabled ? "Motion recording is on." : "Motion recording is off.",
    whyItMatters: "Without motion recording the doorbell sends no motion events, so a caregiver who does not ring is never seen.",
    whereToChange: "In the Ring app, open the doorbell, then Device Settings, then Motion Settings, and turn motion recording on.",
  }
}

const activeZones = (zones: unknown): number | undefined => {
  if (!Array.isArray(zones)) return undefined
  return zones.map(record).filter((zone) => zone !== undefined && zone.enabled !== false && Array.isArray(zone.vertices) && zone.vertices.length >= 3).length
}

const motionZoneItem = (motion: Attributes | undefined): CheckItem => {
  const active = activeZones(motion?.motion_zones)
  return {
    id: "motion_zone",
    title: "Motion Zone Present",
    state: active === undefined ? "unknown" : active > 0 ? "pass" : "fail",
    required: true,
    observed: active === undefined ? "Ring did not report motion zones." : active > 0 ? `${active} active motion ${active === 1 ? "zone" : "zones"}.` : "No active motion zone.",
    whyItMatters: "Ring only reports motion inside a motion zone. A zone over the walkway is what catches the caregiver's arrival and departure.",
    whereToChange: "In the Ring app, open the doorbell, then Motion Settings, then Motion Zones, and draw a zone that covers the walkway to the front door.",
  }
}

const encryptionItem = (config: Attributes | undefined): CheckItem => {
  const e2ee = bool(record(config?.e2e_encryption)?.enabled)
  const observed =
    e2ee === undefined
      ? "Ring did not report the encryption mode."
      : e2ee
        ? "End to end encryption is on. Ring hides events and media from partners, so VisitProof cannot see this doorbell."
        : "Standard encryption. End to end encryption is off, so door events and snapshots can be used."
  return {
    id: "encryption_known",
    title: "Encryption State Known",
    state: e2ee === undefined ? "unknown" : e2ee ? "fail" : "pass",
    required: true,
    observed,
    whyItMatters: "The encryption mode decides whether VisitProof can use events and snapshots. End to end encryption hides the device completely.",
    whereToChange: "In the Ring app, open Control Center, then Video Encryption, to see or change the encryption mode.",
  }
}

const humanDetectionItem = (): CheckItem => ({
  id: "human_detection",
  title: "Human Detection",
  state: "info",
  required: false,
  observed: "Ring's device capabilities do not report person detection. VisitProof sees human motion when Ring sends motion events with a human sub type.",
  whyItMatters: "Person detection lets VisitProof tell a caregiver at the door apart from a passing car or a pet. It is informational and never counts against this doorbell.",
  whereToChange: "Person alerts depend on the doorbell model and the Ring plan. In the Ring app, open the doorbell, then Smart Alerts, and check that People alerts are on.",
})

const locationText = (location: Attributes | undefined): string | undefined => {
  if (!location || typeof location.country !== "string") return undefined
  return typeof location.state === "string" ? `${location.state}, ${location.country}` : location.country
}

const checkDevice = (device: DeviceResource, included: readonly IncludedResource[], timeZone: string): DeviceCheck => {
  const status = includedFor(device, included, DEVICE_RESOURCE_TYPES.status, "status")
  const config = includedFor(device, included, DEVICE_RESOURCE_TYPES.configurations, "configurations")
  const motion = record(config?.motion_detection)
  const items = [onlineItem(status, timeZone), motionRecordingItem(motion), motionZoneItem(motion), encryptionItem(config), humanDetectionItem()]
  const required = items.filter((item) => item.required)
  return {
    deviceId: device.id,
    name: device.attributes.name,
    kind: device.attributes.kind ?? undefined,
    batteryPowered: device.attributes.battery_powered ?? undefined,
    location: locationText(includedFor(device, included, DEVICE_RESOURCE_TYPES.location, "location")),
    items,
    passed: required.filter((item) => item.state === "pass").length,
    required: required.length,
  }
}

export const buildDeviceChecks = (document: DeviceListDocument, options: DeviceCheckOptions = {}): DeviceCheck[] => {
  const included = document.included ?? []
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE
  return document.data.map((device) => checkDevice(device, included, timeZone))
}

/** "4 of 4 required checks passing" (informational items are not counted). */
export const deviceCheckSummary = (check: Pick<DeviceCheck, "passed" | "required">): string =>
  `${check.passed} of ${check.required} required checks passing`
