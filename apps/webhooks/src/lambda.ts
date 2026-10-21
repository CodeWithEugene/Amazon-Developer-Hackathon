import { createDynamoRepository } from "@visitproof/db"
import { parseEnv } from "@visitproof/config"
import { handle } from "hono/aws-lambda"

import { readReceiverConfig } from "./config"
import { createEngineHook } from "./engine-hook"
import { createApp } from "./index"
import { stderrLogger } from "./logger"

/**
 * API Gateway / Lambda handler for the Ring Webhook URL (production).
 * Builds the receiver over the DynamoDB repository. In production the
 * engine runs from DynamoDB Streams (set VISITPROOF_ENGINE_INLINE=false);
 * inline mode schedules it after the 202, which a frozen Lambda may not
 * finish, so it is a development convenience only.
 */
const env = parseEnv(process.env)
const config = readReceiverConfig(process.env)
const repository = createDynamoRepository({
  config: { tableName: env.DYNAMODB_TABLE, region: env.AWS_REGION },
})
const agencyId = process.env.VISITPROOF_AGENCY_ID ?? "a1"

export const handler = handle(
  createApp({
    repository,
    signingKey: config.signingKey,
    mode: config.mode,
    engineInline: config.engineInline,
    agencyId,
    // Unknown event types are logged with their metadata; an S3 raw
    // archive keyed by request id replaces this once the bucket exists.
    archive: {
      put: async (record) =>
        stderrLogger.warn("unknown event archived to log", {
          requestId: record.requestId,
          accountId: record.accountId,
          rawType: record.rawType,
          bytes: record.rawBody.length,
        }),
    },
    ...(config.engineInline ? { onEvent: createEngineHook(repository, agencyId) } : {}),
  })
)
