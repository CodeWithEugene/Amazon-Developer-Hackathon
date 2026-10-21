import { DEFAULT_RING_OAUTH_TOKEN_URL } from "./endpoints"
import { requestWithRetry, resolveFetch, throwForResponse, type FetchLike } from "./http"
import { tokenResponseSchema, type TokenResponse } from "./types"
import { z } from "zod"

/**
 * OAuth token exchange and refresh. The code must be exchanged within 60 s of
 * issue (types.AUTH_CODE_EXCHANGE_BUDGET_MS). Refresh is single-flight (one
 * concurrent refresh regardless of caller count) and rotation-aware (a new
 * refresh token is only stored when the response actually carries one).
 */

export interface TokenStore {
  get(): TokenResponse | undefined
  /** `obtainedAt` is the epoch ms the tokens were issued; persist it with them. */
  set(tokens: TokenResponse, obtainedAt: number): void | Promise<void>
}

export interface ExchangeAuthorizationCodeOptions {
  readonly tokenUrl?: string
  readonly clientId: string
  readonly clientSecret: string
  readonly code: string
  readonly redirectUri?: string
  readonly fetch?: FetchLike
  readonly now?: () => number
  /** Abort the exchange (for example at the 60 s budget). */
  readonly signal?: AbortSignal
}

export interface RefreshAccessTokenOptions {
  readonly tokenUrl?: string
  readonly clientId: string
  readonly clientSecret: string
  readonly refreshToken: string
  readonly fetch?: FetchLike
  readonly now?: () => number
  /** Abort the exchange (for example at the 60 s budget). */
  readonly signal?: AbortSignal
}

/** Refresh responses may omit the refresh token when it was not rotated. */
const refreshResponseSchema = tokenResponseSchema.extend({
  refresh_token: z.string().min(1).optional(),
})

const postForm = async (
  url: string,
  form: Record<string, string>,
  options: {
    readonly fetch?: FetchLike
    readonly now?: () => number
    readonly signal?: AbortSignal
  } = {}
): Promise<unknown> => {
  const body = new URLSearchParams(form)
  // Never retried: a code is single use and a refresh may rotate the token.
  const response = await requestWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      ...(options.signal ? { signal: options.signal } : {}),
    },
    { fetch: resolveFetch(options.fetch), now: options.now, maxRetries: 0 }
  )
  if (!response.ok) await throwForResponse(response, "POST", url, options.now?.() ?? Date.now())
  return response.json()
}

/** Exchanges an authorization code for tokens. Must run within 60 s of issue. */
export const exchangeAuthorizationCode = async (
  options: ExchangeAuthorizationCodeOptions
): Promise<TokenResponse> => {
  const form: Record<string, string> = {
    grant_type: "authorization_code",
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret,
  }
  if (options.redirectUri) form.redirect_uri = options.redirectUri
  const url = options.tokenUrl ?? DEFAULT_RING_OAUTH_TOKEN_URL
  return tokenResponseSchema.parse(
    await postForm(url, form, { fetch: options.fetch, now: options.now, signal: options.signal })
  )
}

/**
 * Refreshes an access token. When the server rotates the refresh token the new
 * one is returned; callers must persist it. Concurrent callers of the manager
 * share one refresh request (see `createTokenManager`).
 */
export const refreshAccessToken = async (
  options: RefreshAccessTokenOptions
): Promise<TokenResponse> => {
  const url = options.tokenUrl ?? DEFAULT_RING_OAUTH_TOKEN_URL
  const parsed = refreshResponseSchema.parse(
    await postForm(
      url,
      {
        grant_type: "refresh_token",
        refresh_token: options.refreshToken,
        client_id: options.clientId,
        client_secret: options.clientSecret,
      },
      { fetch: options.fetch, now: options.now }
    )
  )
  return {
    ...parsed,
    // Rotation-aware: keep the previous refresh token when none was returned.
    refresh_token: parsed.refresh_token ?? options.refreshToken,
  }
}

/** Refresh 30 s before expiry to tolerate clock skew. */
const EXPIRY_SKEW_MS = 30_000

export interface TokenManager {
  getAccessToken(): Promise<string>
  /** Forces the next `getAccessToken` to refresh (for example after a 401). */
  invalidate(): void
}

/**
 * Single-flight, rotation-aware token manager. The first caller after expiry
 * performs the refresh; every concurrent caller awaits the same promise. The
 * stored refresh token is replaced only when the response carries a new one.
 */
export const createTokenManager = (
  options: {
    readonly clientId: string
    readonly clientSecret: string
    readonly tokenUrl?: string
    readonly tokens: TokenResponse
    /** Epoch ms the tokens were issued; defaults to now (fresh tokens). */
    readonly obtainedAt?: number
    readonly store?: TokenStore
    readonly fetch?: FetchLike
    readonly now?: () => number
  },
  refresh: typeof refreshAccessToken = refreshAccessToken
): TokenManager => {
  const now = options.now ?? Date.now
  let current = options.tokens
  let issuedAt = options.obtainedAt ?? now()
  let inflight: Promise<void> | undefined

  const doRefresh = async (): Promise<void> => {
    const fresh = await refresh({
      tokenUrl: options.tokenUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      refreshToken: current.refresh_token,
      fetch: options.fetch,
      now: options.now,
    })
    const obtainedAt = now()
    // Persist before handing the new access token out: a lost rotated
    // refresh token forces the family to re-link.
    await options.store?.set(fresh, obtainedAt)
    current = fresh
    issuedAt = obtainedAt
  }

  return {
    getAccessToken: async () => {
      if (now() - issuedAt >= current.expires_in * 1000 - EXPIRY_SKEW_MS) {
        if (!inflight) {
          inflight = doRefresh().finally(() => {
            inflight = undefined
          })
        }
        await inflight
      }
      return current.access_token
    },
    invalidate: () => {
      issuedAt = -Infinity
    },
  }
}
