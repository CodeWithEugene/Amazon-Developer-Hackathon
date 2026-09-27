import { z } from "zod"

/** Connection settings for the single `visitproof` table. */
export const dbConfigSchema = z.object({
  tableName: z.string().min(1).default("visitproof"),
  region: z.string().min(1).default("us-east-1"),
  endpoint: z.url().optional(),
})

export type DbConfig = z.infer<typeof dbConfigSchema>

/** Index names from docs/build.md Section 4. */
export const TABLE_INDEXES = Object.freeze({
  gsi1: "gsi1",
  gsi2: "gsi2",
} as const)

export const TTL_ATTRIBUTE = "expiresAt" as const

/** Environment variable naming the JSON file used by the local demo store. */
export const DEMO_STORE_PATH_ENV = "VISITPROOF_DEMO_STORE_PATH" as const
export const DEFAULT_DEMO_STORE_PATH = ".visitproof/demo-store.json" as const

/** Environment variable holding the 32-byte AES key for the local token cipher. */
export const LOCAL_TOKEN_KEY_ENV = "VISITPROOF_LOCAL_TOKEN_KEY" as const
