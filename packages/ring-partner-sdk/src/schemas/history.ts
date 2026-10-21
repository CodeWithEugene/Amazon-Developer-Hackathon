import { z } from "zod"

import { jsonApiLinksSchema, relationshipSchema } from "./devices"
import { openEnum } from "./open-enum"

/**
 * History events (docs/research.md Section 2.2): newest first, cursor
 * paginated, time-gated to after consent. `event_type` is open so one new
 * type never makes a whole page throw.
 */

export const KNOWN_HISTORY_EVENT_TYPES = [
  "motion.human",
  "motion.vehicle",
  "motion.animal",
  "motion.other_motion",
  "ding",
  "on_demand",
] as const
export const knownHistoryEventTypeSchema = z.enum(KNOWN_HISTORY_EVENT_TYPES)
export const historyEventTypeSchema = openEnum(KNOWN_HISTORY_EVENT_TYPES)
export type HistoryEventType = z.infer<typeof historyEventTypeSchema>

export const historyEventAttributesSchema = z.looseObject({
  event_type: historyEventTypeSchema,
  timestamp: z.number().int().nonnegative(),
  timestamp_readable: z.string().optional(),
  device_id: z.string().optional(),
  has_recording: z.boolean().optional(),
  duration_sec: z.number().nonnegative().optional(),
})
export type HistoryEventAttributes = z.infer<typeof historyEventAttributesSchema>

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

export const historyQuerySchema = z.object({
  eventTypes: z.array(historyEventTypeSchema).optional(),
  /**
   * Either a `links.next` URL or path (followed as-is) or an opaque
   * `meta.page_key` cursor (sent as the `page_key` query parameter).
   */
  pageKey: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
})
export type HistoryQuery = z.infer<typeof historyQuerySchema>
