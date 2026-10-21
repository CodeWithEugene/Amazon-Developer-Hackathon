import {
  AUTH_CODE_EXCHANGE_BUDGET_MS,
  UNCLAIMED_TOKEN_TTL_MS,
  type TokenResponse,
  type UserDocument,
} from "@visitproof/ring-partner-sdk"
import { z } from "zod"

import { sealTokens } from "./sealed-tokens"
import type { TokenCipher } from "./token-cipher"
import type { RingTokenStore } from "./token-store"

/**
 * Token Exchange URL core (docs/research.md Section 2.3 steps 2 and 3):
 * exchange the authorization code within 60 seconds of issue, call
 * `/v1/users/me` for the account id and email, and store the tokens
 * encrypted as UNCLAIMED for 15 minutes until the Account Link visit
 * matches the nonce. Framework free; the route wires the real ports.
 */

export const tokenExchangeRequestSchema = z.object({
  code: z.string().trim().min(1).max(4_096),
  redirect_uri: z.url().optional(),
})

export interface TokenExchangeDeps {
  readonly exchange: (code: string, signal: AbortSignal) => Promise<TokenResponse>
  readonly me: (accessToken: string) => Promise<UserDocument>
  readonly cipher: TokenCipher
  readonly store: RingTokenStore
  readonly now: () => number
  readonly budgetMs?: number
}

export type TokenExchangeResult =
  | { readonly status: 200; readonly body: { readonly ok: true } }
  | { readonly status: 400 | 502 | 504; readonly body: { readonly error: string; readonly code: string } }

const fail = (status: 400 | 502 | 504, code: string, error: string): TokenExchangeResult => ({
  status,
  body: { error, code },
})

/** The account id Ring uses in the nonce: `attributes.account_id`, else the user id. */
export const accountIdOf = (user: UserDocument): string => user.data.attributes.account_id ?? user.data.id

const exchangeWithin = async (deps: TokenExchangeDeps, code: string) => {
  const signal = AbortSignal.timeout(deps.budgetMs ?? AUTH_CODE_EXCHANGE_BUDGET_MS)
  try {
    return { ok: true as const, tokens: await deps.exchange(code, signal) }
  } catch (error) {
    return { ok: false as const, timedOut: signal.aborted, error }
  }
}

export const handleTokenExchange = async (
  body: unknown,
  deps: TokenExchangeDeps
): Promise<TokenExchangeResult> => {
  const parsed = tokenExchangeRequestSchema.safeParse(body)
  if (!parsed.success) return fail(400, "invalid_request", "Send the authorization code as `code`.")
  const exchanged = await exchangeWithin(deps, parsed.data.code)
  if (!exchanged.ok) {
    return exchanged.timedOut
      ? fail(504, "exchange_timeout", "The authorization code could not be exchanged within 60 seconds.")
      : fail(502, "exchange_failed", "Ring did not accept the authorization code.")
  }
  let user: UserDocument
  try {
    user = await deps.me(exchanged.tokens.access_token)
  } catch {
    return fail(502, "me_failed", "Ring did not return the account for the new token.")
  }
  const obtainedAt = deps.now()
  await deps.store.putUnclaimed({
    accountId: accountIdOf(user),
    ...(user.data.attributes.email ? { email: user.data.attributes.email } : {}),
    encryptedTokens: await sealTokens(deps.cipher, exchanged.tokens),
    obtainedAt,
    expiresAt: obtainedAt + UNCLAIMED_TOKEN_TTL_MS,
  })
  return { status: 200, body: { ok: true } }
}
