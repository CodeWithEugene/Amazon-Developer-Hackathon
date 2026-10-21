import { z } from "zod"

/**
 * Deploy-time settings from CDK context (`-c key=value` or cdk.json). Every
 * value is optional with a safe default so `cdk synth` runs offline with no
 * context, no lookups, and no credentials.
 */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value
const optional = z.preprocess(blankToUndefined, z.string().trim().optional())

export const infraConfigSchema = z.object({
  environment: z.preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default("dev")
  ),
  region: z.preprocess(blankToUndefined, z.string().default("us-east-1")),
  agencyId: z.preprocess(blankToUndefined, z.string().default("a1")),
  /** Email subscribed to the alerts topic (budget and 5xx alarms). */
  alertEmail: z.preprocess(blankToUndefined, z.email().optional()),
  /** SES verified identity; the digest Lambda mails only when set. */
  sesFromAddress: z.preprocess(blankToUndefined, z.email().optional()),
  /** Comma separated sandbox allowlist for SES recipients. */
  sesAllowedRecipients: optional,
  modelProvider: z.preprocess(
    blankToUndefined,
    z.enum(["fixture", "bedrock"]).default("bedrock")
  ),
  bedrockModelId: z.preprocess(
    blankToUndefined,
    z.string().default("global.amazon.nova-2-lite-v1:0")
  ),
  bedrockGuardrailId: optional,
  bedrockGuardrailVersion: optional,
  /** Monthly budget limit in USD; alerts fire at 50 percent and 100 percent. */
  budgetLimitUsd: z.coerce.number().positive().default(100),
})

export type InfraConfig = z.infer<typeof infraConfigSchema>

export const CONTEXT_KEYS = Object.keys(
  infraConfigSchema.shape
) as (keyof InfraConfig)[]

/** Reads and validates every context key from a CDK node. */
export const readInfraConfig = (
  tryGetContext: (key: string) => unknown
): InfraConfig =>
  infraConfigSchema.parse(
    Object.fromEntries(CONTEXT_KEYS.map((key) => [key, tryGetContext(key)]))
  )

export const PROJECT_TAG = Object.freeze({
  key: "Project",
  value: "visitproof",
})
