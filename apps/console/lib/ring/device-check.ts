import type {
  DeviceCapabilitiesAttributes,
  DeviceConfigurationsAttributes,
  DeviceListDocument,
  DeviceResource,
  DeviceStatusAttributes,
  IncludedResource,
} from "@visitproof/ring-partner-sdk"

/**
 * Device Check (docs/build.md Section 5.3): a checklist per shared device
 * from `GET /v1/devices?include=status,capabilities,configurations,location`.
 * Every item that is not passing explains what is wrong, why it matters, and
 * exactly where to change it in the Ring app, because VisitProof cannot
 * change Ring settings itself. Copy is plain, dash free, sentence case.
 */

export type CheckState = "pass" | "fail" | "unknown"

export interface CheckItem {
  readonly id: "online" | "motion_recording" | "motion_zone" | "human_detection" | "encryption_known"
  readonly title: string
  readonly state: CheckState
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
  readonly passed: number
}

type Attributes = Record<string, unknown>

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
  return (match as { attributes?: Attributes } | undefined)?.attributes
}

const bool = (value: unknown): boolean | undefined => (typeof value === "boolean" ? value : undefined)
const stateOf = (value: boolean | undefined): CheckState =>
  value === undefined ? "unknown" : value ? "pass" : "fail"

const onlineItem = (status: Partial<DeviceStatusAttributes> | undefined): CheckItem => {
  const online = bool(status?.online)
  return {
    id: "online",
    title: "Online",
    state: stateOf(online),
    observed: online === undefined ? "Ring did not report the connection state." : online ? "The doorbell is connected." : "The doorbell is offline.",
    whyItMatters: "VisitProof can only see arrivals and departures while the doorbell is connected.",
    whereToChange: "In the Ring app, open the doorbell, then Device Health, and check the Wi-Fi signal and power or battery.",
  }
}

const motionRecordingItem = (config: Partial<DeviceConfigurationsAttributes> | undefined): CheckItem => {
  const enabled = bool(config?.motion_recording_enabled)
  return {
    id: "motion_recording",
    title: "Motion Recording On",
    state: stateOf(enabled),
    observed: enabled === undefined ? "Ring did not report the motion recording setting." : enabled ? "Motion recording is on." : "Motion recording is off.",
    whyItMatters: "Without motion recording the doorbell sends no motion events, so a caregiver who does not ring is never seen.",
    whereToChange: "In the Ring app, open the doorbell, then Device Settings, then Motion Settings, and turn motion recording on.",
  }
}

const motionZoneItem = (config: Partial<DeviceConfigurationsAttributes> | undefined): CheckItem => {
  const zones = Array.isArray(config?.motion_zones) ? config.motion_zones : undefined
  const active = zones?.filter((zone) => zone.enabled !== false && zone.vertices.length >= 3).length
  return {
    id: "motion_zone",
    title: "Motion Zone Present",
    state: active === undefined ? "unknown" : active > 0 ? "pass" : "fail",
    observed: active === undefined ? "Ring did not report motion zones." : active > 0 ? `${active} active motion ${active === 1 ? "zone" : "zones"}.` : "No active motion zone.",
    whyItMatters: "Ring only reports motion inside a motion zone. A zone over the walkway is what catches the caregiver's arrival and departure.",
    whereToChange: "In the Ring app, open the doorbell, then Motion Settings, then Motion Zones, and draw a zone that covers the walkway to the front door.",
  }
}

const humanDetectionItem = (capabilities: Partial<DeviceCapabilitiesAttributes> | undefined): CheckItem => {
  const available = bool(capabilities?.human_detection)
  return {
    id: "human_detection",
    title: "Human Detection Available",
    state: stateOf(available),
    observed: available === undefined ? "Ring did not report person detection." : available ? "Person detection is available." : "This doorbell does not report person detection.",
    whyItMatters: "Person detection lets VisitProof tell a caregiver at the door apart from a passing car or a pet.",
    whereToChange: "Person detection depends on the doorbell model and the Ring plan. In the Ring app, open the doorbell, then Smart Alerts, and check that People alerts are available.",
  }
}

const ENCRYPTION_TEXT: Readonly<Record<string, string>> = {
  clear: "Standard encryption. Events and snapshots can be used.",
  take: "Video is encrypted on the device. VisitProof works from door events only and shows no snapshots.",
  e2ee: "End to end encryption is on. Ring shares no events or media from this device.",
}

const encryptionItem = (status: Partial<DeviceStatusAttributes> | undefined): CheckItem => {
  const state = typeof status?.encryption_state === "string" ? status.encryption_state : undefined
  const known = state !== undefined && state !== "unknown"
  return {
    id: "encryption_known",
    title: "Encryption State Known",
    state: known ? (state === "e2ee" ? "fail" : "pass") : "unknown",
    observed: known ? (ENCRYPTION_TEXT[state] ?? `Encryption mode reported as ${state}.`) : "Ring did not report the encryption mode.",
    whyItMatters: "The encryption mode decides whether VisitProof can use snapshots or only door events, and end to end encryption hides the device completely.",
    whereToChange: "In the Ring app, open Control Center, then Video Encryption, to see or change the encryption mode.",
  }
}

const locationText = (location: Attributes | undefined): string | undefined => {
  if (!location || typeof location.country !== "string") return undefined
  return typeof location.state === "string" ? `${location.state}, ${location.country}` : location.country
}

export const buildDeviceChecks = (document: DeviceListDocument): DeviceCheck[] => {
  const included = document.included ?? []
  return document.data.map((device) => {
    const status = includedFor(device, included, "device_status", "status") as Partial<DeviceStatusAttributes> | undefined
    const capabilities = includedFor(device, included, "device_capabilities", "capabilities") as Partial<DeviceCapabilitiesAttributes> | undefined
    const config = includedFor(device, included, "device_configurations", "configurations") as Partial<DeviceConfigurationsAttributes> | undefined
    const items = [
      onlineItem(status),
      motionRecordingItem(config),
      motionZoneItem(config),
      humanDetectionItem(capabilities),
      encryptionItem(status),
    ]
    return {
      deviceId: device.id,
      name: device.attributes.name,
      kind: device.attributes.kind,
      batteryPowered: device.attributes.battery_powered,
      location: locationText(includedFor(device, included, "device_location", "location")),
      items,
      passed: items.filter((item) => item.state === "pass").length,
    }
  })
}
