import { z } from "zod"

const optionalString = z.string().trim().optional()

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value

/**
 * Every variable from `.env.example`. Demo mode is the default and needs no
 * secrets; live subsystems validate their own required values on demand so
 * partial credentials still work.
 */
export const envSchema = z.object({
  VISITPROOF_MODE: z.preprocess(
    emptyToUndefined,
    z.enum(["demo", "live"]).default("demo")
  ),
  NEXT_PUBLIC_APP_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("http://localhost:3000")
  ),

  RING_CLIENT_ID: optionalString,
  RING_CLIENT_SECRET: optionalString,
  RING_HMAC_SIGNING_KEY: optionalString,
  RING_PLAYGROUND_ACCESS_TOKEN: optionalString,
  RING_API_BASE: z.preprocess(
    emptyToUndefined,
    z.url().default("https://api.amazonvision.com")
  ),
  RING_OAUTH_TOKEN_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("https://oauth.ring.com/oauth/token")
  ),

  AWS_REGION: z.preprocess(emptyToUndefined, z.string().default("us-east-1")),
  DYNAMODB_TABLE: z.preprocess(
    emptyToUndefined,
    z.string().default("visitproof")
  ),
  S3_SNAPSHOT_BUCKET: optionalString,
  KMS_SIGNING_KEY_ID: optionalString,
  KMS_TOKEN_KEY_ID: optionalString,
  SES_FROM_ADDRESS: optionalString,
  BEDROCK_MODEL_ID: z.preprocess(
    emptyToUndefined,
    z.string().default("global.amazon.nova-2-lite-v1:0")
  ),
  BEDROCK_GUARDRAIL_ID: optionalString,
  BEDROCK_GUARDRAIL_VERSION: optionalString,
  COGNITO_USER_POOL_ID: optionalString,
  COGNITO_CLIENT_ID: optionalString,
  MODEL_PROVIDER: z.preprocess(
    emptyToUndefined,
    z.enum(["fixture", "bedrock"]).default("fixture")
  ),

  MCP_PUBLIC_URL: z.preprocess(
    emptyToUndefined,
    z.url().default("http://localhost:8000/mcp")
  ),
  MCP_AUTH_ISSUER: optionalString,
  MCP_DEMO_TOKENS: z.preprocess(
    emptyToUndefined,
    z.string().default("family-demo-token,agency-demo-token")
  ),
})

export type Env = z.infer<typeof envSchema>

export type EnvSource = Readonly<Record<string, string | undefined>>

/**
 * Parses an environment source. Throws a ZodError with every offending key so
 * the app refuses to start on an invalid configuration.
 */
export const parseEnv = (source: EnvSource): Env => envSchema.parse(source)

/** Live Ring credentials, required only when `VISITPROOF_MODE=live`. */
export const ringLiveCredentialsSchema = z.object({
  RING_CLIENT_ID: z.string().min(1),
  RING_CLIENT_SECRET: z.string().min(1),
  RING_HMAC_SIGNING_KEY: z.string().min(1),
})

export type RingLiveCredentials = z.infer<typeof ringLiveCredentialsSchema>
