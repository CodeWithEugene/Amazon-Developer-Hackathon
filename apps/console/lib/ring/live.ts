import "server-only"

import { join } from "node:path"

import {
  createTokenManager,
  RingClient,
  type TokenResponse,
} from "@visitproof/ring-partner-sdk"

import { storeDir } from "@/lib/store"

import { readRingEnv, type RingEnv } from "./env"
import { liveModeOff, RingLiveError, tokenExpired } from "./errors"
import { openTokens, sealTokens } from "./sealed-tokens"
import { tokenCipherFromEnv, type TokenCipher } from "./token-cipher"
import { createFileTokenStore, type LinkedIntegration, type RingTokenStore } from "./token-store"

/**
 * Live Ring mode (contract C6). The console calls the real Ring Partner API
 * when a Playground token is configured (RING_PLAYGROUND_ACCESS_TOKEN, about
 * 30 minutes, no refresh) or when a family has linked a Ring account
 * (OAuth tokens encrypted in the token store, refreshed single flight and
 * persisted on rotation). Otherwise the console stays in demo mode.
 */

export type RingMode = "live" | "demo"
export type RingSource = "playground" | "linked"

export const PROVENANCE_LABELS: Readonly<Record<RingSource, string>> = {
  playground: "Ring Playground sandbox device",
  linked: "Linked Ring account",
}

export interface LiveRingClient {
  readonly client: RingClient
  readonly source: RingSource
  readonly provenanceLabel: string
  readonly accountId?: string
  readonly clientId?: string
}

const warnOnce = (message: string): void => {
  process.stderr.write(`${JSON.stringify({ level: "warn", service: "console", message })}\n`)
}

export const ringEnv = (): RingEnv => readRingEnv(process.env)

export const getTokenCipher = (env: RingEnv = ringEnv()): TokenCipher =>
  tokenCipherFromEnv(env.VISITPROOF_TOKEN_KEY, warnOnce)

/** The token file lives next to the local store (git-ignored demo data). */
export const getTokenStore = (): RingTokenStore => createFileTokenStore(join(storeDir(), "ring-tokens.json"))

/** "live" when a Playground token is set or a Ring account is linked. */
export function getRingMode(): RingMode {
  if (ringEnv().RING_PLAYGROUND_ACCESS_TOKEN) return "live"
  try {
    return getTokenStore().hasLinkedSync() ? "live" : "demo"
  } catch (error) {
    warnOnce(`Ring token store is unreadable, staying in demo mode: ${error instanceof Error ? error.message : String(error)}`)
    return "demo"
  }
}

const playgroundClient = (env: RingEnv, token: string): LiveRingClient => ({
  client: new RingClient({ baseUrl: env.RING_API_BASE, getAccessToken: () => token }),
  source: "playground",
  provenanceLabel: PROVENANCE_LABELS.playground,
})

const staticAccessToken = (tokens: TokenResponse, obtainedAt: number) => () => {
  if (Date.now() - obtainedAt >= tokens.expires_in * 1_000) throw tokenExpired("linked")
  return tokens.access_token
}

const linkedClient = async (env: RingEnv, linked: LinkedIntegration): Promise<LiveRingClient> => {
  const cipher = getTokenCipher(env)
  const store = getTokenStore()
  const tokens = await openTokens(cipher, linked.encryptedTokens)
  const canRefresh = Boolean(env.RING_CLIENT_ID && env.RING_CLIENT_SECRET)
  const manager = canRefresh
    ? createTokenManager({
        clientId: env.RING_CLIENT_ID ?? "",
        clientSecret: env.RING_CLIENT_SECRET ?? "",
        tokenUrl: env.RING_OAUTH_TOKEN_URL,
        tokens,
        obtainedAt: linked.obtainedAt,
        store: {
          get: () => undefined,
          set: async (fresh, obtainedAt) =>
            store.putLinked({
              ...linked,
              encryptedTokens: await sealTokens(cipher, fresh),
              obtainedAt,
              updatedAt: new Date(obtainedAt).toISOString(),
            }),
        },
      })
    : undefined
  return {
    client: new RingClient({
      baseUrl: env.RING_API_BASE,
      getAccessToken: manager ? () => manager.getAccessToken() : staticAccessToken(tokens, linked.obtainedAt),
      ...(manager ? { onUnauthorized: () => manager.invalidate() } : {}),
    }),
    source: "linked",
    provenanceLabel: PROVENANCE_LABELS.linked,
    accountId: linked.accountId,
    clientId: linked.clientId,
  }
}

/**
 * A Ring client for live calls. With `clientId`, that client's own linked
 * account wins; otherwise the Playground token (a shared sandbox device, no
 * household data). Another household's linked account is never used.
 * Throws `RingLiveError`: "live_mode_off" in demo mode, "not_linked" when
 * only other households are linked.
 */
export async function getRingClient(options: { readonly clientId?: string } = {}): Promise<LiveRingClient> {
  const env = ringEnv()
  const store = getTokenStore()
  const own = options.clientId ? await store.getLinked(options.clientId) : null
  if (own) return linkedClient(env, own)
  if (env.RING_PLAYGROUND_ACCESS_TOKEN) return playgroundClient(env, env.RING_PLAYGROUND_ACCESS_TOKEN)
  if (store.hasLinkedSync()) {
    throw new RingLiveError("not_linked", "This household has not linked a Ring account yet. Link it from the Ring app first.")
  }
  throw liveModeOff()
}

export { RingLiveError }
