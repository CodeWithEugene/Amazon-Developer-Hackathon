import { computeAccountLinkNonce, unclaimedBucketId } from "@visitproof/ring-partner-sdk"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { checkLinkRequest, completeAccountLink, type CompleteLinkDeps } from "./account-link"
import { sealTokens } from "./sealed-tokens"
import { TEST_CIPHER, TEST_TOKENS, tempRepository, testClient } from "./testing/fixtures"
import { createMemoryTokenStore, type RingTokenStore } from "./token-store"

const KEY = "hmac-signing-key"
const ACCOUNT = "ava1.ring.account.okoro"
const NOW = Date.UTC(2026, 9, 1, 12)

let store: RingTokenStore

const query = (time = NOW - 5_000, account = ACCOUNT) => ({
  nonce: computeAccountLinkNonce(KEY, time, account),
  time: String(time),
})

beforeEach(async () => {
  store = createMemoryTokenStore()
  for (const accountId of ["ava1.ring.account.other", ACCOUNT]) {
    await store.putUnclaimed({
      accountId,
      email: `${accountId}@example.com`,
      encryptedTokens: await sealTokens(TEST_CIPHER, TEST_TOKENS),
      obtainedAt: NOW - 60_000,
      expiresAt: NOW + 14 * 60_000,
    })
  }
})

describe("checkLinkRequest", () => {
  const deps = () => ({ store, hmacKey: KEY, now: () => NOW })

  it("matches the nonce to the right UNCLAIMED account and exposes the Ring email", async () => {
    const check = await checkLinkRequest(query(), deps())
    expect(check.ok && check.unclaimed.accountId).toBe(ACCOUNT)
    expect(check.ok && check.unclaimed.email).toBe(`${ACCOUNT}@example.com`)
  })

  it("rejects stale, future, malformed, and unmatched links", async () => {
    expect(await checkLinkRequest(query(NOW - 601_000), deps())).toEqual({ ok: false, reason: "stale" })
    expect(await checkLinkRequest(query(NOW + 120_000), deps())).toEqual({ ok: false, reason: "future" })
    expect(await checkLinkRequest({ nonce: "", time: "x" }, deps())).toEqual({ ok: false, reason: "invalid" })
    expect(await checkLinkRequest({ ...query(), nonce: "forged" }, deps())).toEqual({ ok: false, reason: "no_match" })
    expect(await checkLinkRequest(query(), { ...deps(), hmacKey: "" })).toEqual({ ok: false, reason: "misconfigured" })
  })
})

describe("completeAccountLink", () => {
  const setup = async (ring = { appIntegrationConfirm: vi.fn(async () => null), appIntegrationComplete: vi.fn(async () => null) }) => {
    const repository = await tempRepository()
    await repository.clients.put(testClient("cli_okoro"))
    const deps: CompleteLinkDeps = {
      store,
      hmacKey: KEY,
      now: () => NOW,
      cipher: TEST_CIPHER,
      repository,
      agencyId: "a1",
      integrationClientFor: vi.fn(() => ring),
    }
    return { deps, repository, ring }
  }

  it("confirms with the nonce, completes with PATCH, links, and moves unclaimed events", async () => {
    const { deps, repository, ring } = await setup()
    await repository.events.put({
      clientId: unclaimedBucketId(ACCOUNT),
      requestId: "req-device-added",
      timestampMs: NOW - 30_000,
      at: new Date(NOW - 30_000).toISOString(),
      type: "device_added",
      provenance: "ring_webhook",
      rawPayloadHash: "hash",
      componentIds: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
      version: 1,
    })
    const q = query()
    const result = await completeAccountLink({ query: q, clientId: "cli_okoro" }, deps)
    expect(result).toEqual({ ok: true, accountId: ACCOUNT, movedEvents: 1 })
    expect(deps.integrationClientFor).toHaveBeenCalledWith("test-access")
    expect(ring.appIntegrationConfirm).toHaveBeenCalledWith({ account_identifier: "cli_okoro", nonce: q.nonce })
    expect(ring.appIntegrationComplete).toHaveBeenCalledTimes(1)
    expect(await repository.ringLinks.clientIdFor(ACCOUNT)).toBe("cli_okoro")
    expect((await repository.clients.get("a1", "cli_okoro"))?.ringLinkStatus).toBe("linked")
    expect(await repository.events.byClient("cli_okoro")).toHaveLength(1)
    expect((await store.getLinked("cli_okoro"))?.integrationStatus).toBe("completed")
    expect(await store.listUnclaimed(NOW)).toHaveLength(1)
  })

  it("is single use: a second visit with the same nonce finds nothing", async () => {
    const { deps } = await setup()
    await completeAccountLink({ query: query(), clientId: "cli_okoro" }, deps)
    expect(await completeAccountLink({ query: query(), clientId: "cli_okoro" }, deps)).toEqual({
      ok: false,
      reason: "no_match",
    })
  })

  it("restores the UNCLAIMED token when Ring rejects the confirm", async () => {
    const ring = {
      appIntegrationConfirm: vi.fn(async () => Promise.reject(new Error("422"))),
      appIntegrationComplete: vi.fn(async () => null),
    }
    const { deps, repository } = await setup(ring)
    const result = await completeAccountLink({ query: query(), clientId: "cli_okoro" }, deps)
    expect(result).toEqual({ ok: false, reason: "ring_rejected" })
    expect(ring.appIntegrationComplete).not.toHaveBeenCalled()
    expect(await repository.ringLinks.clientIdFor(ACCOUNT)).toBeNull()
    expect((await store.listUnclaimed(NOW)).map((entry) => entry.accountId)).toContain(ACCOUNT)
  })
})
