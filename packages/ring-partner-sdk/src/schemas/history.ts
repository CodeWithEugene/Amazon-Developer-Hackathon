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

/**
 * A Ring time value. The live Playground returns epoch milliseconds as
 * numbers (`start`, `end`); an ISO 8601 string is also accepted.
 */
export const ringTimeSchema = z.union([
  z.number().int().nonnegative(),
  z.string().refine((value) => Number.isFinite(Date.parse(value)), "Expected an ISO 8601 time"),
])
export type RingTime = z.infer<typeof ringTimeSchema>

/**
 * Accepts both the documented shape (`timestamp`, `device_id`) and the shape
 * the live API actually returns (`start`/`end` in epoch ms,
 * `is_third_party_reviewed`, device in `relationships.source`). At least one
 * of `timestamp` or `start` is required.
 */
export const historyEventAttributesSchema = z
  .looseObject({
    event_type: historyEventTypeSchema,
    timestamp: z.number().int().nonnegative().optional(),
    timestamp_readable: z.string().optional(),
    start: ringTimeSchema.optional(),
    end: ringTimeSchema.optional(),
    is_third_party_reviewed: z.boolean().optional(),
    device_id: z.string().optional(),
    has_recording: z.boolean().optional(),
    duration_sec: z.number().nonnegative().optional(),
  })
  .refine((attributes) => attributes.timestamp !== undefined || attributes.start !== undefined, {
    message: "A history event needs a timestamp or a start time",
  })
export type HistoryEventAttributes = z.infer<typeof historyEventAttributesSchema>

export const historyEventSchema = z.looseObject({
  id: z.string().min(1),
  /** Live API: "history-events"; docs: "history_events". */
  type: z.enum(["history-events", "history_events"]),
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

const ringTimeToMs = (value: RingTime): number => (typeof value === "number" ? value : Date.parse(value))

/** When the event happened, in epoch ms (`start` on the live API, else `timestamp`). */
export const historyEventTimeMs = (event: Pick<HistoryEvent, "attributes">): number => {
  const { start, timestamp } = event.attributes
  if (start !== undefined) return ringTimeToMs(start)
  return timestamp ?? Number.NaN
}

/** When the event happened, as an ISO 8601 string. */
export const historyEventTimeIso = (event: Pick<HistoryEvent, "attributes">): string =>
  new Date(historyEventTimeMs(event)).toISOString()

/** The source device: `attributes.device_id`, else `relationships.source`. */
export const historyEventDeviceId = (event: HistoryEvent): string | undefined => {
  if (event.attributes.device_id) return event.attributes.device_id
  const data = event.relationships?.source?.data
  return data && !Array.isArray(data) ? data.id : undefined
}
