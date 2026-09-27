import { z } from "zod"

/**
 * Ring Partner API wire types (docs/research.md Section 2). This file is the
 * shared contract between the SDK, the webhook receiver, the emulator, and the
 * engine. JSON:API documents use `z.looseObject` so unknown attributes from
 * the live API are preserved rather than rejected.
 */

// ---------------------------------------------------------------------------
// Webhook envelope v1.1
// ---------------------------------------------------------------------------

export const WEBHOOK_VERSION = "1.1" as const
export const WEBHOOK_SIGNATURE_HEADER = "x-signature" as const
export const WEBHOOK_SIGNATURE_PREFIX = "sha256=" as const

export const webhookMetaSchema = z.object({
  version: z.string().min(1),
  time: z.iso.datetime({ offset: true }),
  request_id: z.string().min(1),
  account_id: z.string().min(1),
})
export type WebhookMeta = z.infer<typeof webhookMetaSchema>

export const motionSubTypeSchema = z.enum([
  "human",
  "vehicle",
  "animal",
  "other_motion",
])
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

/** Early Access sensor events. Names follow the documented `<sensor>_<state>` pattern. */
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

const sourceTypeSchema = z.enum(["devices", "accounts", "subscriptions"])

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
  type: z.enum([
    "device_added",
    "device_removed",
    "device_online",
    "device_offline",
  ]),
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

// ---------------------------------------------------------------------------
// JSON:API device documents
// ---------------------------------------------------------------------------

export const jsonApiLinksSchema = z.looseObject({
  self: z.string().optional(),
  next: z.string().nullable().optional(),
  related: z.string().optional(),
})
export type JsonApiLinks = z.infer<typeof jsonApiLinksSchema>

export const resourceIdentifierSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
})
export type ResourceIdentifier = z.infer<typeof resourceIdentifierSchema>

export const relationshipSchema = z.looseObject({
  data: z
    .union([resourceIdentifierSchema, z.array(resourceIdentifierSchema)])
    .nullable()
    .optional(),
  links: jsonApiLinksSchema.optional(),
})

export const deviceKindSchema = z.enum([
  "doorbell",
  "camera",
  "chime",
  "sensor",
  "unknown",
])
export type DeviceKind = z.infer<typeof deviceKindSchema>

export const deviceAttributesSchema = z.looseObject({
  name: z.string().min(1),
  kind: deviceKindSchema.optional(),
  device_type: z.string().optional(),
  model: z.string().optional(),
  firmware_version: z.string().optional(),
  battery_powered: z.boolean().optional(),
})
export type DeviceAttributes = z.infer<typeof deviceAttributesSchema>

export const deviceResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("devices"),
  attributes: deviceAttributesSchema,
  relationships: z.record(z.string(), relationshipSchema).optional(),
  links: jsonApiLinksSchema.optional(),
})
export type DeviceResource = z.infer<typeof deviceResourceSchema>

export const deviceStatusAttributesSchema = z.looseObject({
  online: z.boolean(),
  last_seen_at: z.string().optional(),
  battery_level: z.number().min(0).max(100).optional(),
  encryption_state: z.enum(["clear", "take", "e2ee", "unknown"]).optional(),
})
export type DeviceStatusAttributes = z.infer<
  typeof deviceStatusAttributesSchema
>

export const deviceStatusResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_status"),
  attributes: deviceStatusAttributesSchema,
})
export type DeviceStatusResource = z.infer<typeof deviceStatusResourceSchema>

export const deviceCapabilitiesAttributesSchema = z.looseObject({
  motion_detection: z.boolean().optional(),
  human_detection: z.boolean().optional(),
  live_view: z.boolean().optional(),
  snapshots: z.boolean().optional(),
  chime_controls: z.boolean().optional(),
  video_codecs: z.array(z.string()).optional(),
  components: z.array(z.looseObject({ id: z.string() })).optional(),
})
export type DeviceCapabilitiesAttributes = z.infer<
  typeof deviceCapabilitiesAttributesSchema
>

export const deviceCapabilitiesResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_capabilities"),
  attributes: deviceCapabilitiesAttributesSchema,
})
export type DeviceCapabilitiesResource = z.infer<
  typeof deviceCapabilitiesResourceSchema
>

export const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const zoneSchema = z.looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  vertices: z.array(normalizedPointSchema),
})
export type Zone = z.infer<typeof zoneSchema>

export const deviceConfigurationsAttributesSchema = z.looseObject({
  motion_recording_enabled: z.boolean().optional(),
  motion_zones: z.array(zoneSchema).optional(),
  privacy_zones: z.array(zoneSchema).optional(),
})
export type DeviceConfigurationsAttributes = z.infer<
  typeof deviceConfigurationsAttributesSchema
>

export const deviceConfigurationsResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_configurations"),
  attributes: deviceConfigurationsAttributesSchema,
})
export type DeviceConfigurationsResource = z.infer<
  typeof deviceConfigurationsResourceSchema
>

export const deviceLocationAttributesSchema = z.looseObject({
  country: z.string().min(2),
  state: z.string().optional(),
})

export const deviceLocationResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_location"),
  attributes: deviceLocationAttributesSchema,
})
export type DeviceLocationResource = z.infer<
  typeof deviceLocationResourceSchema
>

export const includedResourceSchema = z.discriminatedUnion("type", [
  deviceStatusResourceSchema,
  deviceCapabilitiesResourceSchema,
  deviceConfigurationsResourceSchema,
  deviceLocationResourceSchema,
])
export type IncludedResource = z.infer<typeof includedResourceSchema>

export const deviceDocumentSchema = z.looseObject({
  data: deviceResourceSchema,
  included: z.array(includedResourceSchema).optional(),
  links: jsonApiLinksSchema.optional(),
})
export type DeviceDocument = z.infer<typeof deviceDocumentSchema>

export const deviceListDocumentSchema = z.looseObject({
  data: z.array(deviceResourceSchema),
  included: z.array(includedResourceSchema).optional(),
  links: jsonApiLinksSchema.optional(),
})
export type DeviceListDocument = z.infer<typeof deviceListDocumentSchema>

export const deviceIncludeSchema = z.enum([
  "status",
  "capabilities",
  "location",
  "configurations",
])
export type DeviceInclude = z.infer<typeof deviceIncludeSchema>

// ---------------------------------------------------------------------------
// History events
// ---------------------------------------------------------------------------

export const historyEventTypeSchema = z.enum([
  "motion.human",
  "motion.vehicle",
  "motion.animal",
  "motion.other_motion",
  "ding",
  "on_demand",
])
export type HistoryEventType = z.infer<typeof historyEventTypeSchema>

export const historyEventAttributesSchema = z.looseObject({
  event_type: historyEventTypeSchema,
  timestamp: z.number().int().nonnegative(),
  timestamp_readable: z.string().optional(),
  device_id: z.string().optional(),
  has_recording: z.boolean().optional(),
  duration_sec: z.number().nonnegative().optional(),
})
export type HistoryEventAttributes = z.infer<
  typeof historyEventAttributesSchema
>

export const historyEventSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("history_events"),
  attributes: historyEventAttributesSchema,
  relationships: z.record(z.string(), relationshipSchema).optional(),
})
export type HistoryEvent = z.infer<typeof historyEventSchema>

export const historyDocumentSchema = z.looseObject({
  data: z.array(historyEventSchema),
  links: jsonApiLinksSchema.optional(),
  meta: z
    .looseObject({
      page_key: z.string().nullable().optional(),
    })
    .optional(),
})
export type HistoryDocument = z.infer<typeof historyDocumentSchema>

// ---------------------------------------------------------------------------
// Users, integrations, subscriptions
// ---------------------------------------------------------------------------

export const userDocumentSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().min(1),
    type: z.literal("users"),
    attributes: z.looseObject({
      email: z.string().optional(),
      account_id: z.string().optional(),
    }),
  }),
})
export type UserDocument = z.infer<typeof userDocumentSchema>

export const appIntegrationStatusSchema = z.enum([
  "pending",
  "awaiting",
  "completed",
])
export type AppIntegrationStatus = z.infer<typeof appIntegrationStatusSchema>

export const appIntegrationConfirmRequestSchema = z.object({
  account_identifier: z.string().min(1),
  nonce: z.string().min(1),
})
export type AppIntegrationConfirmRequest = z.infer<
  typeof appIntegrationConfirmRequestSchema
>

export const subscriptionStateSchema = z.enum([
  "paid",
  "trial",
  "expired",
  "cancelled",
])
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().default("Bearer"),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

export const accountLinkQuerySchema = z.object({
  nonce: z.string().min(1),
  time: z.coerce.number().int().nonnegative(),
})
export type AccountLinkQuery = z.infer<typeof accountLinkQuerySchema>

export const ACCOUNT_LINK_MAX_AGE_MS = 600_000 as const
export const AUTH_CODE_EXCHANGE_BUDGET_MS = 60_000 as const

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const snapshotTypeSchema = z.enum(["at_timestamp", "latest_in_range"])
export type SnapshotType = z.infer<typeof snapshotTypeSchema>

export const mediaOriginSchema = z.enum(["recording", "snapshot"])
export type MediaOrigin = z.infer<typeof mediaOriginSchema>

export const mediaErrorCodeSchema = z.enum([
  "MEDIA_NOT_FOUND",
  "RECORDING_NOT_READY",
  "TIME_RANGE_NOT_AUTHORIZED",
  "MEDIA_ENCRYPTED",
])
export type MediaErrorCode = z.infer<typeof mediaErrorCodeSchema>

export const whepStartResponseSchema = z.object({
  sdpAnswer: z.string().min(1),
  sessionUrl: z.string().min(1),
})
export type WhepStartResponse = z.infer<typeof whepStartResponseSchema>

// ---------------------------------------------------------------------------
// Error document
// ---------------------------------------------------------------------------

export const errorObjectSchema = z.looseObject({
  status: z.union([z.string(), z.number()]).optional(),
  code: z.string().optional(),
  title: z.string().optional(),
  detail: z.string().optional(),
  source: z
    .looseObject({
      pointer: z.string().optional(),
      parameter: z.string().optional(),
    })
    .optional(),
})
export type ErrorObject = z.infer<typeof errorObjectSchema>

export const errorDocumentSchema = z.looseObject({
  errors: z.array(errorObjectSchema).min(1),
})
export type ErrorDocument = z.infer<typeof errorDocumentSchema>

// ---------------------------------------------------------------------------
// Single-resource documents, subscriptions, app integrations, clips
// ---------------------------------------------------------------------------

export const deviceStatusDocumentSchema = z.looseObject({
  data: deviceStatusResourceSchema,
})
export type DeviceStatusDocument = z.infer<typeof deviceStatusDocumentSchema>

export const deviceCapabilitiesDocumentSchema = z.looseObject({
  data: deviceCapabilitiesResourceSchema,
})
export type DeviceCapabilitiesDocument = z.infer<
  typeof deviceCapabilitiesDocumentSchema
>

export const deviceConfigurationsDocumentSchema = z.looseObject({
  data: deviceConfigurationsResourceSchema,
})
export type DeviceConfigurationsDocument = z.infer<
  typeof deviceConfigurationsDocumentSchema
>

export const deviceLocationDocumentSchema = z.looseObject({
  data: deviceLocationResourceSchema,
})
export type DeviceLocationDocument = z.infer<typeof deviceLocationDocumentSchema>

export const subscriptionResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("subscriptions"),
  attributes: z.looseObject({
    state: subscriptionStateSchema,
    device_id: z.string().optional(),
    plan: z.string().optional(),
    renews_at: z.string().optional(),
    ends_at: z.string().optional(),
  }),
})
export type SubscriptionResource = z.infer<typeof subscriptionResourceSchema>

export const subscriptionListDocumentSchema = z.looseObject({
  data: z.array(subscriptionResourceSchema),
  links: jsonApiLinksSchema.optional(),
})
export type SubscriptionListDocument = z.infer<
  typeof subscriptionListDocumentSchema
>

export const appIntegrationDocumentSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().min(1),
    type: z.literal("app_integrations"),
    attributes: z.looseObject({
      status: appIntegrationStatusSchema,
      account_identifier: z.string().optional(),
    }),
  }),
})
export type AppIntegrationDocument = z.infer<typeof appIntegrationDocumentSchema>

export const clipRequestSchema = z.object({
  start_time: z.number().int().nonnegative(),
  end_time: z.number().int().nonnegative(),
})
export type ClipRequest = z.infer<typeof clipRequestSchema>

/** Clips are capped at 15 minutes (docs/research.md Section 2.2). */
export const CLIP_MAX_DURATION_MS = 15 * 60 * 1000

export const historyQuerySchema = z.object({
  eventTypes: z.array(historyEventTypeSchema).optional(),
  pageKey: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
})
export type HistoryQuery = z.infer<typeof historyQuerySchema>
