import type { WebhookEvent } from "../types"
import type { PrimitiveKind } from "./scenarios"
import { readableTimestamp } from "./time-zone"

/**
 * Primitive event bodies in Ring's v1.1 shape: `data.id` follows
 * `<device_id>_<kind>_<timestamp>` (for example `..._motion_1786715596787`)
 * and `timestamp_readable` is `YYYY-MM-DD HH:mm:ss` in device local time.
 */

type EventBody = Omit<WebhookEvent, "id">

const deviceLink = (source: string) => ({ devices: { links: { self: `/v1/devices/${source}` } } })

const deviceAttributes = (source: string, at: number, timeZone: string) => ({
  source,
  source_type: "devices" as const,
  timestamp: at,
  timestamp_readable: readableTimestamp(at, timeZone),
})

const motion = (subType: string) => (source: string, at: number, timeZone: string): EventBody => ({
  type: "motion_detected",
  relationships: deviceLink(source),
  attributes: { ...deviceAttributes(source, at, timeZone), sub_type: subType, component_ids: ["0"] },
})

const lifecycle =
  (type: "device_online" | "device_offline") =>
  (source: string, at: number, timeZone: string): EventBody => ({
    type,
    relationships: deviceLink(source),
    attributes: deviceAttributes(source, at, timeZone),
  })

export const KIND_TO_EVENT: Readonly<
  Record<PrimitiveKind, (source: string, at: number, timeZone: string) => EventBody>
> = {
  ding: (source, at, timeZone) => ({
    type: "button_press",
    relationships: deviceLink(source),
    attributes: deviceAttributes(source, at, timeZone),
  }),
  motion_human: motion("human"),
  motion_vehicle: motion("vehicle"),
  motion_animal: motion("animal"),
  motion_other: motion("other_motion"),
  device_offline: lifecycle("device_offline"),
  device_online: lifecycle("device_online"),
  integration_removed: (source, at, timeZone) => ({
    type: "app_integration_removed",
    relationships: undefined,
    attributes: { ...deviceAttributes(source, at, timeZone), source_type: "accounts" },
  }),
  integration_added: (source, at, timeZone) => ({
    type: "app_integration_added",
    relationships: undefined,
    attributes: { ...deviceAttributes(source, at, timeZone), source_type: "accounts" },
  }),
  subscription_deactivated: (source, at, timeZone) => ({
    type: "subscription_deactivated",
    relationships: undefined,
    attributes: { ...deviceAttributes(source, at, timeZone), source_type: "subscriptions" },
  }),
}

const SHORT_NAMES: Readonly<Partial<Record<WebhookEvent["type"], string>>> = {
  motion_detected: "motion",
  button_press: "ding",
}

/** Ring-style `data.id`: `<source>_<short type>_<timestamp>`. */
export const eventId = (source: string, type: WebhookEvent["type"], at: number): string =>
  `${source}_${SHORT_NAMES[type] ?? type}_${at}`
