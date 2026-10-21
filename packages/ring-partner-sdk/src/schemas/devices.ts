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

export const KNOWN_ENCRYPTION_STATES = ["clear", "take", "e2ee", "unknown"] as const
export const encryptionStateWireSchema = openEnum(KNOWN_ENCRYPTION_STATES)

export const deviceStatusAttributesSchema = z.looseObject({
  online: z.boolean(),
  last_seen_at: z.string().optional(),
  battery_level: z.number().min(0).max(100).optional(),
  encryption_state: encryptionStateWireSchema.optional(),
})
export type DeviceStatusAttributes = z.infer<typeof deviceStatusAttributesSchema>

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
export type DeviceCapabilitiesAttributes = z.infer<typeof deviceCapabilitiesAttributesSchema>

export const deviceCapabilitiesResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_capabilities"),
  attributes: deviceCapabilitiesAttributesSchema,
})
export type DeviceCapabilitiesResource = z.infer<typeof deviceCapabilitiesResourceSchema>

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
export type DeviceConfigurationsAttributes = z.infer<typeof deviceConfigurationsAttributesSchema>

export const deviceConfigurationsResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_configurations"),
  attributes: deviceConfigurationsAttributesSchema,
})
export type DeviceConfigurationsResource = z.infer<typeof deviceConfigurationsResourceSchema>

export const deviceLocationAttributesSchema = z.looseObject({
  country: z.string().min(2),
  state: z.string().optional(),
})

export const deviceLocationResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("device_location"),
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
