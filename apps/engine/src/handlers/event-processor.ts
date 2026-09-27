/**
 * Event processor (DynamoDB Streams). Persists the door event, then applies
 * the pure Presence Engine to the matched visit. Deterministic decisions only.
 */
import {
  DEFAULT_TOLERANCES,
  doorEventSchema,
  processEvent,
  systemResolution,
  type DoorEvent,
} from "@visitproof/domain"
import type { DynamoDBStreamEvent } from "aws-lambda"

import { unmarshalItem } from "../lib/dynamodb"
import type { EngineDeps } from "../lib/ports"

export const handlerName = "event-processor"

export function createEventProcessor(deps: EngineDeps) {
  return async function eventProcessor(streamEvent: DynamoDBStreamEvent): Promise<void> {
    for (const record of streamEvent.Records ?? []) {
      // Per-record isolation: one poison record must not fail the whole
      // batch (which would retry-loop every good record behind it).
      try {
        const image = unmarshalItem(
          record.dynamodb?.NewImage as Record<string, never> | undefined
        )
        const parsed = doorEventSchema.safeParse(image)
        if (!parsed.success) {
          console.warn(`[event-processor] skipping unparseable stream record`, parsed.error.message)
          continue
        }
        await ingestDoorEvent(deps, parsed.data)
      } catch (error) {
        console.error(
          `[event-processor] failed to process stream record ${record.eventID ?? "<unknown>"}`,
          error
        )
      }
    }
  }
}

/** Shared ingestion path: also called by the webhook receiver (apps/webhooks). */
export async function ingestDoorEvent(deps: EngineDeps, event: DoorEvent): Promise<void> {
  await deps.events.append(event)
  const visits = await deps.visits.listForClient(event.clientId)
  const events = await deps.events.listForClient(event.clientId)
  const openExceptions = await deps.exceptions.listOpen()
  const now = deps.clock.now()

  const result = processEvent({
    event,
    events,
    visits,
    openExceptions,
    tolerances: DEFAULT_TOLERANCES,
    now,
  })
  if (result.matched && result.visit) {
    await deps.visits.save(result.visit)
  }
  for (const exception of result.toRaise) {
    await deps.exceptions.open(exception)
  }
  for (const id of result.toResolveIds) {
    await deps.exceptions.resolve(
      id,
      systemResolution(now, result.visit?.arrival ? "arrival observed" : "superseded")
    )
  }
}
