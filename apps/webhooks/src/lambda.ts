import { createDynamoRepository } from "@visitproof/db"
import { parseEnv } from "@visitproof/config"
import { handle } from "hono/aws-lambda"

import { createEngineHook } from "./engine-hook"
import { createApp } from "./index"

/**
 * API Gateway / Lambda handler for the Ring Webhook URL (production).
 * Builds the receiver over the DynamoDB repository from the Lambda env and
 * ingests each persisted event with the real Presence Engine.
 */
const env = parseEnv(process.env)
const repository = createDynamoRepository({
  config: { tableName: env.DYNAMODB_TABLE, region: env.AWS_REGION },
})
const signingKey = env.RING_HMAC_SIGNING_KEY ?? ""
const agencyId = process.env.VISITPROOF_AGENCY_ID ?? "a1"
const onEvent = createEngineHook(repository, agencyId)

export const handler = handle(createApp({ repository, signingKey, onEvent }))
