import { describe, expect, it, vi } from "vitest"

import { openTokens } from "./sealed-tokens"
import { TEST_CIPHER, TEST_TOKENS, testUser } from "./testing/fixtures"
import { handleTokenExchange, type TokenExchangeDeps } from "./token-exchange"
import { createMemoryTokenStore } from "./token-store"

const NOW = Date.UTC(2026, 9, 1, 12)

const deps = (overrides: Partial<TokenExchangeDeps> = {}): TokenExchangeDeps => ({
  exchange: vi.fn(async () => TEST_TOKENS),
  me: vi.fn(async () => testUser("ava1.ring.account.okoro")),
  cipher: TEST_CIPHER,
  store: createMemoryTokenStore(),
  now: () => NOW,
  ...overrides,
})

describe("handleTokenExchange", () => {
  it("exchanges the code, calls users/me, and stores an encrypted UNCLAIMED token for 15 minutes", async () => {
    const d = deps()
    const result = await handleTokenExchange({ code: "auth-code" }, d)
    expect(result).toEqual({ status: 200, body: { ok: true } })
    expect(d.exchange).toHaveBeenCalledWith("auth-code", expect.any(AbortSignal))
    expect(d.me).toHaveBeenCalledWith("test-access")
    const [record] = await d.store.listUnclaimed(NOW)
    expect(record).toMatchObject({
      accountId: "ava1.ring.account.okoro",
      email: "family@example.com",
      obtainedAt: NOW,
      expiresAt: NOW + 15 * 60_000,
    })
    expect(record?.encryptedTokens).not.toContain("test-access")
    expect(await openTokens(TEST_CIPHER, record!.encryptedTokens)).toEqual(TEST_TOKENS)
    expect(await d.store.listUnclaimed(NOW + 15 * 60_000)).toHaveLength(0)
  })

  it("rejects a body without a code", async () => {
    const d = deps()
    expect((await handleTokenExchange({}, d)).status).toBe(400)
    expect(d.exchange).not.toHaveBeenCalled()
  })

  it("aborts at the 60 second budget and stores nothing", async () => {
    const exchange = vi.fn(
      (_code: string, signal: AbortSignal) =>
        new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)))
    )
    const d = deps({ exchange, budgetMs: 20 })
    const result = await handleTokenExchange({ code: "slow" }, d)
    expect(result.status).toBe(504)
    expect(await d.store.listUnclaimed(NOW)).toHaveLength(0)
  })

  it("maps an exchange or users/me failure to 502 without storing", async () => {
    const refused = deps({ exchange: vi.fn(async () => Promise.reject(new Error("invalid_grant"))) })
    expect((await handleTokenExchange({ code: "used" }, refused)).status).toBe(502)
    const noUser = deps({ me: vi.fn(async () => Promise.reject(new Error("401"))) })
    expect(await handleTokenExchange({ code: "ok" }, noUser)).toMatchObject({ status: 502, body: { code: "me_failed" } })
    expect(await noUser.store.listUnclaimed(NOW)).toHaveLength(0)
  })
})
