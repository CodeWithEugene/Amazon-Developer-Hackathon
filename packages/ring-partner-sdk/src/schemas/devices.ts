import { z } from "zod"

import { openEnum } from "./open-enum"

/**
 * JSON:API device documents (docs/research.md Section 2.2). Every object is
 * loose so unknown attributes survive, every enum is open, and an unknown
 * `included` resource type is kept through a fallback member instead of
 * failing the whole document.
 */

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

export const KNOWN_DEVICE_KINDS = ["doorbell", "camera", "chime", "sensor", "unknown"] as const
export const deviceKindSchema = openEnum(KNOWN_DEVICE_KINDS)
export type DeviceKind = z.infer<typeof deviceKindSchema>

/** The Playground device carries only `name` and `image_url`; the rest are optional. */
export const deviceAttributesSchema = z.looseObject({
  name: z.string().min(1),
  image_url: z.string().nullable().optional(),
  kind: deviceKindSchema.nullable().optional(),
  device_type: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  firmware_version: z.string().nullable().optional(),
  battery_powered: z.boolean().nullable().optional(),
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

/**
 * Device sub-resources, shaped by real Ring Playground responses captured on
 * 22 October 2026 (src/fixtures/playground/). Ring returns `null` for many
 * fields a device does not support (snooze, sensor detections, audio slots),
 * so every attribute that is not load bearing is `nullish`. The fields
 * VisitProof depends on are still validated: `online`, `reported_at`,
 * `motion_detection.enabled`, motion zone geometry, and
 * `e2e_encryption.enabled`.
 */

const nullish = <T extends z.ZodType>(schema: T) => schema.nullable().optional()

export const DEVICE_RESOURCE_TYPES = {
  status: "device-status",
  capabilities: "device-capabilities",
  configurations: "device-configurations",
  location: "locations",
} as const

/** Not observed on the Playground; kept for older or future payloads. */
export const KNOWN_ENCRYPTION_STATES = ["clear", "take", "e2ee", "unknown"] as const
export const encryptionStateWireSchema = openEnum(KNOWN_ENCRYPTION_STATES)

export const deviceStatusAttributesSchema = z.looseObject({
  online: z.boolean(),
  reported_at: nullish(z.iso.datetime({ offset: true })),
  /** Device state (null on the Playground doorbell). */
  state: nullish(z.string()),
  audio: nullish(
    z.looseObject({
      snooze: nullish(
        z.looseObject({ active: nullish(z.boolean()), until: nullish(z.string()) })
      ),
    })
  ),
  battery_level: nullish(z.number().min(0).max(100)),
  encryption_state: nullish(encryptionStateWireSchema),
})
export type DeviceStatusAttributes = z.infer<typeof deviceStatusAttributesSchema>

export const deviceStatusResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal(DEVICE_RESOURCE_TYPES.status),
  attributes: deviceStatusAttributesSchema,
})
export type DeviceStatusResource = z.infer<typeof deviceStatusResourceSchema>

/** A capability: `null` when unsupported, otherwise the settings it exposes. */
export const capabilityFeatureSchema = nullish(
  z.looseObject({ configurations: nullish(z.array(z.string())) })
)

export const deviceCapabilitiesAttributesSchema = z.looseObject({
  motion_detection: capabilityFeatureSchema,
  image_enhancements: capabilityFeatureSchema,
  video: nullish(
    z.looseObject({
      configurations: nullish(z.array(z.string())),
      codecs: nullish(z.array(z.string())),
      ratio: nullish(z.string()),
      max_resolution: nullish(z.number()),
      supported_resolutions: nullish(z.array(z.number())),
    })
  ),
  audio: nullish(
    z.looseObject({
      customizable_slots: nullish(z.array(z.unknown())),
      supported_actions: nullish(z.array(z.string())),
    })
  ),
  battery_status: capabilityFeatureSchema,
  flood_detection: capabilityFeatureSchema,
  freeze_detection: capabilityFeatureSchema,
  smoke_detection: capabilityFeatureSchema,
  co_detection_listener: capabilityFeatureSchema,
  glass_break_detection: capabilityFeatureSchema,
  tamper_detection: capabilityFeatureSchema,
  contact_detection: capabilityFeatureSchema,
})
export type DeviceCapabilitiesAttributes = z.infer<typeof deviceCapabilitiesAttributesSchema>

export const deviceCapabilitiesResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal(DEVICE_RESOURCE_TYPES.capabilities),
  attributes: deviceCapabilitiesAttributesSchema,
})
export type DeviceCapabilitiesResource = z.infer<typeof deviceCapabilitiesResourceSchema>

export const normalizedPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const zoneSchema = z.looseObject({
  id: nullish(z.string()),
  name: nullish(z.string()),
  enabled: nullish(z.boolean()),
  vertices: z.array(normalizedPointSchema),
})
export type Zone = z.infer<typeof zoneSchema>

/** Ring reports toggles as "on" or "off" strings. */
export const KNOWN_TOGGLE_STATES = ["on", "off"] as const
export const toggleStateSchema = openEnum(KNOWN_TOGGLE_STATES)

export const deviceConfigurationsAttributesSchema = z.looseObject({
  motion_detection: nullish(
    z.looseObject({
      enabled: nullish(toggleStateSchema),
      motion_zones: nullish(z.array(zoneSchema)),
    })
  ),
  /** `false` is standard encryption; `true` hides events and media from partners. */
  e2e_encryption: nullish(z.looseObject({ enabled: nullish(z.boolean()) })),
  image_enhancements: nullish(
    z.looseObject({ privacy_zones: nullish(z.array(zoneSchema)) })
  ),
  audio: nullish(
    z.looseObject({
      volume: nullish(z.number()),
      customizable_slots: nullish(z.array(z.unknown())),
    })
  ),
})
export type DeviceConfigurationsAttributes = z.infer<typeof deviceConfigurationsAttributesSchema>

export const deviceConfigurationsResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal(DEVICE_RESOURCE_TYPES.configurations),
  attributes: deviceConfigurationsAttributesSchema,
})
export type DeviceConfigurationsResource = z.infer<typeof deviceConfigurationsResourceSchema>

export const deviceLocationAttributesSchema = z.looseObject({
  country: z.string().min(2),
  state: nullish(z.string()),
})
export type DeviceLocationAttributes = z.infer<typeof deviceLocationAttributesSchema>

export const deviceLocationResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal(DEVICE_RESOURCE_TYPES.location),
  attributes: deviceLocationAttributesSchema,
})
export type DeviceLocationResource = z.infer<typeof deviceLocationResourceSchema>

/** Known included resources, discriminated on `type`. */
export const knownIncludedResourceSchema = z.discriminatedUnion("type", [
  deviceStatusResourceSchema,
  deviceCapabilitiesResourceSchema,
  deviceConfigurationsResourceSchema,
  deviceLocationResourceSchema,
])
export type KnownIncludedResource = z.infer<typeof knownIncludedResourceSchema>

/** Any other included resource, preserved untouched. */
export const otherIncludedResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
})

export const includedResourceSchema = z.union([
  knownIncludedResourceSchema,
  otherIncludedResourceSchema,
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

export const deviceIncludeSchema = z.enum(["status", "capabilities", "location", "configurations"])
export type DeviceInclude = z.infer<typeof deviceIncludeSchema>

export const deviceStatusDocumentSchema = z.looseObject({ data: deviceStatusResourceSchema })
export type DeviceStatusDocument = z.infer<typeof deviceStatusDocumentSchema>

export const deviceCapabilitiesDocumentSchema = z.looseObject({
  data: deviceCapabilitiesResourceSchema,
})
export type DeviceCapabilitiesDocument = z.infer<typeof deviceCapabilitiesDocumentSchema>

export const deviceConfigurationsDocumentSchema = z.looseObject({
  data: deviceConfigurationsResourceSchema,
})
export type DeviceConfigurationsDocument = z.infer<typeof deviceConfigurationsDocumentSchema>

export const deviceLocationDocumentSchema = z.looseObject({ data: deviceLocationResourceSchema })
export type DeviceLocationDocument = z.infer<typeof deviceLocationDocumentSchema>
