import { z } from "zod"

/**
 * Receiver configuration from the environment (Zod at the boundary).
 * VISITPROOF_ENGINE_INLINE ("true" by default, "false" to disable) decides
 * whether the receiver runs the Presence Engine after acknowledging; the demo
 * disables it and replays the engine in simulated time (contract C5).
 */

const flag = (fallback: boolean) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((value) => (value === undefined || value === "" ? fallback : value !== "false"))

export const receiverEnvSchema = z.object({
  VISITPROOF_MODE: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === "live" ? "live" : "demo") as "live" | "demo"),
  VISITPROOF_ENGINE_INLINE: flag(true),
  RING_HMAC_SIGNING_KEY: z.string().trim().optional().default(""),
  PORT: z.coerce.number().int().min(0).max(65_535).optional(),
})

export interface ReceiverConfig {
  readonly mode: "live" | "demo"
  readonly engineInline: boolean
  readonly signingKey: string
  readonly port: number | undefined
}

export const readReceiverConfig = (
  env: Readonly<Record<string, string | undefined>>
): ReceiverConfig => {
  const parsed = receiverEnvSchema.parse(env)
  return {
    mode: parsed.VISITPROOF_MODE,
    engineInline: parsed.VISITPROOF_ENGINE_INLINE,
    signingKey: parsed.RING_HMAC_SIGNING_KEY,
    port: parsed.PORT,
  }
}
