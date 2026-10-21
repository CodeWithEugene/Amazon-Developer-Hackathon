import { z } from "zod"

import { openEnum } from "./open-enum"

/**
 * Webhook envelope v1.1 (docs/research.md Section 2.2). `webhookEnvelopeSchema`
 * is the strict, discriminated contract for the known event families;
 * `rawWebhookEnvelopeSchema` is the lenient shape a receiver falls back to so a
 * validly signed delivery with a new `data.type` is stored, never 400ed.
 */

export const WEBHOOK_VERSION = "1.1" as const
export const WEBHOOK_SIGNATURE_HEADER = "x-signature" as const
export const WEBHOOK_SIGNATURE_PREFIX = "sha256=" as const
/** Demo-only header the emulator sets; honored only when VISITPROOF_MODE is demo. */
export const PROVENANCE_HEADER = "x-visitproof-provenance" as const
export const EMULATED_PROVENANCE = "emulated" as const

export const webhookMetaSchema = z.object({
  version: z.string().min(1),
  time: z.iso.datetime({ offset: true }),
  request_id: z.string().min(1),
  account_id: z.string().min(1),
})
export type WebhookMeta = z.infer<typeof webhookMetaSchema>

export const KNOWN_MOTION_SUB_TYPES = ["human", "vehicle", "animal", "other_motion"] as const
export const knownMotionSubTypeSchema = z.enum(KNOWN_MOTION_SUB_TYPES)
/** Open: Ring may add sub types (for example package); they are kept as-is. */
export const motionSubTypeSchema = openEnum(KNOWN_MOTION_SUB_TYPES)
export type MotionSubType = z.infer<typeof motionSubTypeSchema>

export const deviceEventTypeSchema = z.enum([
  "motion_detected",
  "button_press",
  "device_added",
  "device_removed",
  "device_online",
  "device_offline",
])
export type DeviceEventType = z.infer<typeof deviceEventTypeSchema>

export const integrationEventTypeSchema = z.enum([
  "app_integration_added",
  "app_integration_removed",
])
export type IntegrationEventType = z.infer<typeof integrationEventTypeSchema>

export const subscriptionEventTypeSchema = z.enum([
  "subscription_activated",
  "subscription_deactivated",
])
export type SubscriptionEventType = z.infer<typeof subscriptionEventTypeSchema>

/**
 * Early Access sensor events. Names follow the documented `<sensor>_<state>`
 * pattern; any other sensor name arrives through the lenient raw envelope.
 */
export const sensorEventTypeSchema = z.enum([
  "contact_sensor_faulted",
  "contact_sensor_cleared",
  "tamper_detected",
  "tamper_cleared",
  "flood_detected",
  "flood_cleared",
  "freeze_detected",
  "freeze_cleared",
  "temperature_high",
  "temperature_low",
  "temperature_normal",
  "humidity_high",
  "humidity_low",
  "humidity_normal",
  "pm25_high",
  "pm25_normal",
  "co_detected",
  "co_cleared",
])
export type SensorEventType = z.infer<typeof sensorEventTypeSchema>

export const webhookEventTypeSchema = z.enum([
  ...deviceEventTypeSchema.options,
  ...integrationEventTypeSchema.options,
  ...subscriptionEventTypeSchema.options,
  ...sensorEventTypeSchema.options,
])
export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>

const KNOWN_SOURCE_TYPES = ["devices", "accounts", "subscriptions"] as const
const sourceTypeSchema = openEnum(KNOWN_SOURCE_TYPES)

const baseAttributesSchema = z.looseObject({
  source: z.string().min(1),
  source_type: sourceTypeSchema,
  timestamp: z.number().int().nonnegative(),
  timestamp_readable: z.string().optional(),
})

const relationshipsSchema = z
  .looseObject({
    devices: z
      .looseObject({
        links: z.looseObject({ self: z.string() }).optional(),
      })
      .optional(),
  })
  .optional()

const eventBase = {
  id: z.string().min(1),
  relationships: relationshipsSchema,
}

export const motionDetectedEventSchema = z.object({
  ...eventBase,
  type: z.literal("motion_detected"),
  attributes: baseAttributesSchema.extend({
    sub_type: motionSubTypeSchema,
    component_ids: z.array(z.string()).optional(),
  }),
})
export type MotionDetectedEvent = z.infer<typeof motionDetectedEventSchema>

export const buttonPressEventSchema = z.object({
  ...eventBase,
  type: z.literal("button_press"),
  attributes: baseAttributesSchema,
})
export type ButtonPressEvent = z.infer<typeof buttonPressEventSchema>

export const deviceLifecycleEventSchema = z.object({
  ...eventBase,
  type: z.enum(["device_added", "device_removed", "device_online", "device_offline"]),
  attributes: baseAttributesSchema,
})
export type DeviceLifecycleEvent = z.infer<typeof deviceLifecycleEventSchema>

export const integrationEventSchema = z.object({
  ...eventBase,
  type: integrationEventTypeSchema,
  attributes: baseAttributesSchema,
})
export type IntegrationEvent = z.infer<typeof integrationEventSchema>

export const subscriptionEventSchema = z.object({
  ...eventBase,
  type: subscriptionEventTypeSchema,
  attributes: baseAttributesSchema.extend({
    subscription_id: z.string().optional(),
    plan: z.string().optional(),
  }),
})
export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>

export const sensorEventSchema = z.object({
  ...eventBase,
  type: sensorEventTypeSchema,
  attributes: baseAttributesSchema.extend({
    value: z.number().optional(),
    unit: z.string().optional(),
  }),
})
export type SensorEvent = z.infer<typeof sensorEventSchema>

/** Discriminated on `type`; add new event families here, never in consumers. */
export const webhookEventSchema = z.discriminatedUnion("type", [
  motionDetectedEventSchema,
  buttonPressEventSchema,
  deviceLifecycleEventSchema,
  integrationEventSchema,
  subscriptionEventSchema,
  sensorEventSchema,
])
export type WebhookEvent = z.infer<typeof webhookEventSchema>

export const webhookEnvelopeSchema = z.object({
  meta: webhookMetaSchema,
  data: webhookEventSchema,
})
export type WebhookEnvelope = z.infer<typeof webhookEnvelopeSchema>

/** Lenient event: only `type` is required; everything else is preserved. */
export const rawWebhookEventSchema = z.looseObject({
  id: z.string().optional(),
  type: z.string().min(1),
  attributes: z
    .looseObject({
      source: z.string().optional(),
      source_type: z.string().optional(),
      timestamp: z.number().optional(),
      timestamp_readable: z.string().optional(),
    })
    .optional(),
  relationships: relationshipsSchema,
})
export type RawWebhookEvent = z.infer<typeof rawWebhookEventSchema>

/** Lenient envelope: `meta` must still carry the request and account ids. */
export const rawWebhookEnvelopeSchema = z.object({
  meta: z.looseObject({
    version: z.string().optional(),
    time: z.string().optional(),
    request_id: z.string().min(1),
    account_id: z.string().min(1),
  }),
  data: rawWebhookEventSchema,
})
export type RawWebhookEnvelope = z.infer<typeof rawWebhookEnvelopeSchema>
