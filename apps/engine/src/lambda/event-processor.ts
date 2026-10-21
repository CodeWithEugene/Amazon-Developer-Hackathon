/**
 * Lambda entry: DynamoDB Streams event processor (EngineStack). The event
 * source mapping enables ReportBatchItemFailures, so the returned
 * `batchItemFailures` drive per-record retries.
 */
import { createAwsDeps } from "../aws-deps"
import { createEventProcessor } from "../handlers/event-processor"

const { deps } = createAwsDeps(process.env)

export const handler = createEventProcessor(deps)
