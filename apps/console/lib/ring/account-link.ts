import type { VisitProofRepository } from "@visitproof/db"
import {
  accountLinkQuerySchema,
  DEFAULT_NONCE_WINDOW_SEC,
  findMatchingAccount,
  isFresh,
  unclaimedBucketId,
  type AppIntegrationConfirmRequest,
} from "@visitproof/ring-partner-sdk"

import { openTokens } from "./sealed-tokens"
import type { TokenCipher } from "./token-cipher"
import type { RingTokenStore, UnclaimedToken } from "./token-store"

/**
 * Account Link URL core (docs/research.md Section 2.3 steps 5 to 8): check
 * freshness (600 s, not in the future), match the nonce against every
 * UNCLAIMED token in constant time, then confirm (`POST app-integrations`)
 * and complete (`PATCH status completed`) the integration, persist the
 * linked tokens, link the Ring account to the client, and move any events
 * that arrived while the account was UNCLAIMED onto the client.
 */

const FUTURE_SKEW_MS = 30_000

export interface IntegrationClient {
  appIntegrationConfirm(request: AppIntegrationConfirmRequest): Promise<unknown>
  appIntegrationComplete(): Promise<unknown>
}

export interface LinkCheckDeps {
  readonly store: RingTokenStore
  readonly hmacKey: string
  readonly now: () => number
}

export type LinkCheck =
  | { readonly ok: true; readonly nonce: string; readonly time: number; readonly unclaimed: UnclaimedToken }
  | { readonly ok: false; readonly reason: "invalid" | "stale" | "future" | "no_match" | "misconfigured" }

export const checkLinkRequest = async (query: unknown, deps: LinkCheckDeps): Promise<LinkCheck> => {
  if (!deps.hmacKey) return { ok: false, reason: "misconfigured" }
  const parsed = accountLinkQuerySchema.safeParse(query)
  if (!parsed.success) return { ok: false, reason: "invalid" }
  const { nonce, time } = parsed.data
  const now = deps.now()
  if (time > now + FUTURE_SKEW_MS) return { ok: false, reason: "future" }
  if (!isFresh(time, now, DEFAULT_NONCE_WINDOW_SEC, FUTURE_SKEW_MS)) return { ok: false, reason: "stale" }
  const candidates = await deps.store.listUnclaimed(now)
  const accountId = findMatchingAccount(deps.hmacKey, nonce, time, candidates.map((entry) => entry.accountId))
  const unclaimed = candidates.find((entry) => entry.accountId === accountId)
  return unclaimed ? { ok: true, nonce, time, unclaimed } : { ok: false, reason: "no_match" }
}

export interface CompleteLinkDeps extends LinkCheckDeps {
  readonly cipher: TokenCipher
  readonly repository: VisitProofRepository
  readonly agencyId: string
  readonly integrationClientFor: (accessToken: string) => IntegrationClient
}

export type CompleteLinkResult =
  | { readonly ok: true; readonly accountId: string; readonly movedEvents: number }
  | { readonly ok: false; readonly reason: LinkCheckFailure | "taken" | "ring_rejected" }

type LinkCheckFailure = Extract<LinkCheck, { ok: false }>["reason"]

/** Copies events stored under the UNCLAIMED bucket onto the client. */
const moveUnclaimedEvents = async (repository: VisitProofRepository, accountId: string, clientId: string) => {
  const pending = await repository.events.byClient(unclaimedBucketId(accountId))
  for (const event of pending) await repository.events.put({ ...event, clientId })
  return pending.length
}

const markClientLinked = async (deps: CompleteLinkDeps, clientId: string, nowIso: string) => {
  const client = await deps.repository.clients.get(deps.agencyId, clientId)
  if (client === null) return
  await deps.repository.clients.put({
    ...client,
    ringLinkStatus: "linked",
    consent: { ...client.consent, consentedAt: client.consent.consentedAt ?? nowIso },
    updatedAt: nowIso,
    version: client.version + 1,
  })
}

const confirmAndComplete = async (deps: CompleteLinkDeps, unclaimed: UnclaimedToken, nonce: string, clientId: string) => {
  const tokens = await openTokens(deps.cipher, unclaimed.encryptedTokens)
  const ring = deps.integrationClientFor(tokens.access_token)
  await ring.appIntegrationConfirm({ account_identifier: clientId, nonce })
  await ring.appIntegrationComplete()
}

export const completeAccountLink = async (
  input: { readonly query: unknown; readonly clientId: string },
  deps: CompleteLinkDeps
): Promise<CompleteLinkResult> => {
  const check = await checkLinkRequest(input.query, deps)
  if (!check.ok) return check
  const unclaimed = await deps.store.takeUnclaimed(check.unclaimed.accountId, deps.now())
  if (unclaimed === null) return { ok: false, reason: "taken" }
  try {
    await confirmAndComplete(deps, unclaimed, check.nonce, input.clientId)
  } catch {
    // Put the token back so the family can retry inside the link window.
    await deps.store.putUnclaimed(unclaimed)
    return { ok: false, reason: "ring_rejected" }
  }
  const nowIso = new Date(deps.now()).toISOString()
  await deps.store.putLinked({
    clientId: input.clientId,
    accountId: unclaimed.accountId,
    ...(unclaimed.email ? { email: unclaimed.email } : {}),
    encryptedTokens: unclaimed.encryptedTokens,
    obtainedAt: unclaimed.obtainedAt,
    integrationStatus: "completed",
    linkedAt: nowIso,
    updatedAt: nowIso,
  })
  await deps.repository.ringLinks.link(input.clientId, unclaimed.accountId, new Date(deps.now()))
  await markClientLinked(deps, input.clientId, nowIso)
  const movedEvents = await moveUnclaimedEvents(deps.repository, unclaimed.accountId, input.clientId)
  return { ok: true, accountId: unclaimed.accountId, movedEvents }
}
