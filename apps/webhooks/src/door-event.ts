import { createHash } from "node:crypto"

import type { DoorEvent, DoorEventType } from "@visitproof/domain"
import type {
  WebhookEnvelope,
  WebhookEvent,
} from "@visitproof/ring-partner-sdk"
import { extractDeviceId } from "@visitproof/ring-partner-sdk"

import { systemClock, type Clock } from "./clock"

/**
 * Envelope to `DoorEvent` mapping (docs/build.md Section 4 and Section 5.2).
 * Subscription lifecycle events have no door-side meaning yet and map to
 * `null`; they are still delivered to the injected engine handler.
 */

const doorEventTypeOf = (event: WebhookEvent): DoorEventType | null => {
  switch (event.type) {
    case "motion_detected":
      return "motion"
    case "button_press":
      return "ding"
    case "device_added":
    case "device_removed":
    case "device_online":
    case "device_offline":
      return event.type
    case "app_integration_added":
      return "integration_added"
    case "app_integration_removed":
      return "integration_removed"
    case "subscription_activated":
    case "subscription_deactivated":
      return null
    default:
      return "sensor"
  }
}

export interface MappedDoorEvent {
  readonly type: DoorEventType
  readonly subType?: string
  readonly componentIds: string[]
}

/** The door-facing projection of an envelope, without storage keys. */
const projectDoorEvent = (
  envelope: WebhookEnvelope
): MappedDoorEvent | null => {
  const { data } = envelope
  const type = doorEventTypeOf(data)
  if (type === null) return null
  const subType =
    data.type === "motion_detected" ? data.attributes.sub_type : data.type
  return {
    type,
    ...(subType !== undefined ? { subType } : {}),
    componentIds:
      data.type === "motion_detected" ? (data.attributes.component_ids ?? []) : [],
  }
}

const sha256Hex = (raw: Uint8Array): string =>
  createHash("sha256").update(raw).digest("hex")

export interface BuildDoorEventInput {
  readonly envelope: WebhookEnvelope
  readonly clientId: string
  readonly rawBody: Uint8Array
  readonly clock: Clock
}

/** The persisted `DoorEvent` for a verified envelope, or null if unmappable. */
export const buildDoorEvent = ({
  envelope,
  clientId,
  rawBody,
  clock,
}: BuildDoorEventInput): DoorEvent | null => {
  const projected = projectDoorEvent(envelope)
  if (projected === null) return null
  const at = new Date(envelope.data.attributes.timestamp)
  const now = clock().toISOString()
  const deviceId = extractDeviceId(envelope)
  return {
    clientId,
    requestId: envelope.meta.request_id,
    timestampMs: envelope.data.attributes.timestamp,
    at: at.toISOString(),
    type: projected.type,
    ...(projected.subType !== undefined ? { subType: projected.subType } : {}),
    ...(deviceId !== undefined ? { deviceId } : {}),
    provenance: "ring_webhook",
    rawPayloadHash: sha256Hex(rawBody),
    componentIds: projected.componentIds,
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
}

export { systemClock }
export type { Clock }
