import { z } from "zod"

/**
 * Ring live-mode settings, validated at the boundary. Only the Ring and
 * token-key variables are read here so an unrelated misconfiguration never
 * takes the Ring pages down. Server-only callers pass `process.env`.
 */

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === undefined || value === "" ? undefined : value))

const urlWithDefault = (fallback: string) =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value))
    .pipe(z.url())

export const ringEnvSchema = z.object({
  VISITPROOF_MODE: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "live" ? "live" : "demo") as "live" | "demo"),
  RING_PLAYGROUND_ACCESS_TOKEN: optional,
  RING_CLIENT_ID: optional,
  RING_CLIENT_SECRET: optional,
  RING_HMAC_SIGNING_KEY: optional,
  RING_API_BASE: urlWithDefault("https://api.amazonvision.com"),
  RING_OAUTH_TOKEN_URL: urlWithDefault("https://oauth.ring.com/oauth/token"),
  /** 32-byte key, base64; a random per-process key is used when unset. */
  VISITPROOF_TOKEN_KEY: optional,
})

export type RingEnv = z.infer<typeof ringEnvSchema>

export const readRingEnv = (
  source: Readonly<Record<string, string | undefined>> = process.env
): RingEnv => ringEnvSchema.parse(source)
