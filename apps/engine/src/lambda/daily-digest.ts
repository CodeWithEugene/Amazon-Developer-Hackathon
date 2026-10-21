/**
 * Lambda entry: the daily family digest over SES (EventBridge rule,
 * EngineStack). The same mailer sends exception alerts when invoked with
 * `{ "kind": "exception_alert", "clientId": "..." }`. A scheduled event
 * carries none of these fields and runs the digest for every client.
 */
import { z } from "zod"

import { createAwsDeps } from "../aws-deps"
import { createMailer } from "../handlers/mailer"

const inputSchema = z.object({
  kind: z.enum(["exception_alert", "digest"]).default("digest"),
  clientId: z.string().min(1).optional(),
  date: z.iso.date().optional(),
})

const { deps } = createAwsDeps(process.env)
const mailer = createMailer(deps)

export const handler = async (event: unknown): Promise<void> => {
  const input = inputSchema.parse(
    typeof event === "object" && event !== null ? event : {}
  )
  await mailer(input)
}
