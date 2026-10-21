/**
 * Event processor (DynamoDB Streams). Applies the pure Presence Engine to the
 * visit a new door event matches. Deterministic decisions only.
 *
 * Failure semantics (the event source mapping sets ReportBatchItemFailures):
 * - a record that is not a door event, or fails the schema, is skipped and
 *   logged: retrying cannot fix it;
 * - any other error (throttling, a transient DynamoDB fault) is reported as a
 *   batch item failure so Lambda retries from that record. Processing stops at
 *   the first failure because the retry restarts from its sequence number.
 */
import {
  doorEventSchema,
  processEvent,
  type DoorEvent,
  type ProcessEventInput,
} from "@visitproof/domain"
import type {
  DynamoDBBatchResponse,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from "aws-lambda"

import { timeZoneFor, tolerancesFor } from "../lib/agency"
import { applyExceptions, applyVisit, ledgerDoorEvent } from "../lib/apply"
import { unmarshalItem } from "../lib/dynamodb"
import { consoleLogger, type EngineDeps } from "../lib/ports"

export const handlerName = "event-processor"

const DOOR_EVENT_SK_PREFIX = "EVENT#"

type Parsed =
  { kind: "event"; event: DoorEvent } | { kind: "skip"; reason: string }

function parseRecord(record: DynamoDBRecord): Parsed {
  if (record.eventName !== undefined && record.eventName !== "INSERT") {
    return { kind: "skip", reason: `ignored ${record.eventName}` }
  }
  const image = unmarshalItem(
    record.dynamodb?.NewImage as Record<string, never> | undefined
  )
  if (image === null) return { kind: "skip", reason: "no new image" }
  const sk = image.sk
  if (typeof sk === "string" && !sk.startsWith(DOOR_EVENT_SK_PREFIX)) {
    return { kind: "skip", reason: "not a door event" }
  }
  const parsed = doorEventSchema.safeParse(image)
  if (!parsed.success) return { kind: "skip", reason: parsed.error.message }
  return { kind: "event", event: parsed.data }
}

export function createEventProcessor(deps: EngineDeps) {
  const logger = deps.logger ?? consoleLogger
  return async function eventProcessor(
    streamEvent: DynamoDBStreamEvent
  ): Promise<DynamoDBBatchResponse> {
    for (const record of streamEvent.Records ?? []) {
      const parsed = parseRecord(record)
      if (parsed.kind === "skip") {
        if (
          parsed.reason !== "not a door event" &&
          !parsed.reason.startsWith("ignored")
        ) {
          logger.warn(
            "[event-processor] skipping unprocessable stream record",
            {
              eventId: record.eventID,
              reason: parsed.reason,
            }
          )
        }
        continue
      }
      try {
        // append is an idempotent conditional put, so re-appending the
        // persisted event keeps in-memory and DynamoDB stores consistent.
        await ingestDoorEvent(deps, parsed.event)
      } catch (error) {
        const itemIdentifier =
          record.dynamodb?.SequenceNumber ?? record.eventID ?? ""
        logger.error("[event-processor] record failed; reporting for retry", {
          eventId: record.eventID,
          sequenceNumber: itemIdentifier,
          error: error instanceof Error ? error.message : String(error),
        })
        return { batchItemFailures: [{ itemIdentifier }] }
      }
    }
    return { batchItemFailures: [] }
  }
}

export interface IngestOptions {
  /**
   * Append the event before processing (default true). Pass false when the
   * caller already persisted it and its store does not dedupe appends.
   */
  persist?: boolean
}

/** Everything the engine needs to judge one event for its client. */
async function eventInput(
  deps: EngineDeps,
  event: DoorEvent,
  now: Date
): Promise<ProcessEventInput> {
  const visits = await deps.visits.listForClient(event.clientId)
  const agencyId = visits[0]?.agencyId
  const [events, openExceptions, exceptions, client, deviceStates] =
    await Promise.all([
      deps.events.listForClient(event.clientId),
      deps.exceptions.listOpen(),
      deps.exceptions.listForClient(event.clientId),
      deps.clients.get(event.clientId),
      deps.devices?.forClient(event.clientId, now),
    ])
  return {
    event,
    events,
    visits,
    openExceptions,
    exceptions,
    tolerances: await tolerancesFor(deps, agencyId),
    now,
    ...(client ? { client } : {}),
    ...(deviceStates ? { deviceStates } : {}),
    timeZone: await timeZoneFor(deps, agencyId),
  }
}

/** Shared ingestion path: also called by the webhook receiver (apps/webhooks). */
export async function ingestDoorEvent(
  deps: EngineDeps,
  event: DoorEvent,
  options: IngestOptions = {}
): Promise<void> {
  if (options.persist ?? true) await deps.events.append(event)
  const now = deps.clock.now()
  const input = await eventInput(deps, event, now)
  const result = processEvent(input)
  await ledgerDoorEvent(deps, event, now)
  if (result.judgment) {
    deps.logger?.info?.("[event-processor] arrival judgment", {
      clientId: event.clientId,
      visitId: result.visit?.id,
      judgment: result.judgment,
    })
  }
  if (result.matched && result.visit) {
    const before = input.visits.find((visit) => visit.id === result.visit?.id)
    await applyVisit(deps, before, result.visit, now)
  }
  await applyExceptions(
    deps,
    {
      toRaise: result.toRaise,
      resolutions: result.resolutions ?? [],
      existing: input.exceptions ?? [],
    },
    now
  )
}
