import { z } from "zod"

import { jsonApiLinksSchema } from "./devices"
import { openEnum } from "./open-enum"

/** Users, app integrations, subscriptions, OAuth, and account linking. */

export const userDocumentSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().min(1),
    type: z.literal("users"),
    attributes: z.looseObject({
      email: z.string().optional(),
      account_id: z.string().optional(),
    }),
  }),
})
export type UserDocument = z.infer<typeof userDocumentSchema>

export const KNOWN_APP_INTEGRATION_STATUSES = [
  "pending",
  "awaiting",
  "completed",
  "inactive",
  "deleted",
] as const
export const appIntegrationStatusSchema = openEnum(KNOWN_APP_INTEGRATION_STATUSES)
export type AppIntegrationStatus = z.infer<typeof appIntegrationStatusSchema>

export const appIntegrationConfirmRequestSchema = z.object({
  account_identifier: z.string().min(1),
  nonce: z.string().min(1),
})
export type AppIntegrationConfirmRequest = z.infer<typeof appIntegrationConfirmRequestSchema>

export const appIntegrationDocumentSchema = z.looseObject({
  data: z.looseObject({
    id: z.string().min(1),
    type: z.literal("app_integrations"),
    attributes: z.looseObject({
      status: appIntegrationStatusSchema,
      account_identifier: z.string().optional(),
    }),
  }),
})
export type AppIntegrationDocument = z.infer<typeof appIntegrationDocumentSchema>

export const KNOWN_SUBSCRIPTION_STATES = ["paid", "trial", "expired", "cancelled"] as const
export const subscriptionStateSchema = openEnum(KNOWN_SUBSCRIPTION_STATES)
export type SubscriptionState = z.infer<typeof subscriptionStateSchema>

export const subscriptionResourceSchema = z.looseObject({
  id: z.string().min(1),
  type: z.literal("subscriptions"),
  attributes: z.looseObject({
    state: subscriptionStateSchema,
    device_id: z.string().optional(),
    plan: z.string().optional(),
    renews_at: z.string().optional(),
    ends_at: z.string().optional(),
  }),
})
export type SubscriptionResource = z.infer<typeof subscriptionResourceSchema>

export const subscriptionListDocumentSchema = z.looseObject({
  data: z.array(subscriptionResourceSchema),
  links: jsonApiLinksSchema.optional(),
})
export type SubscriptionListDocument = z.infer<typeof subscriptionListDocumentSchema>

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  scope: z.string().optional(),
  expires_in: z.number().int().positive(),
  token_type: z.string().default("Bearer"),
})
export type TokenResponse = z.infer<typeof tokenResponseSchema>

export const accountLinkQuerySchema = z.object({
  nonce: z.string().min(1),
  time: z.coerce.number().int().nonnegative(),
})
export type AccountLinkQuery = z.infer<typeof accountLinkQuerySchema>

export const ACCOUNT_LINK_MAX_AGE_MS = 600_000 as const
export const AUTH_CODE_EXCHANGE_BUDGET_MS = 60_000 as const
/** UNCLAIMED tokens expire if no Account Link visit claims them in time. */
export const UNCLAIMED_TOKEN_TTL_MS = 15 * 60_000
