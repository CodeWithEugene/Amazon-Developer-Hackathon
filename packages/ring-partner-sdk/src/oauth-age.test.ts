import { describe, expect, it, vi } from "vitest"

import type { FetchLike } from "./http"
import { createTokenManager, refreshAccessToken } from "./oauth"
import { RingServiceUnavailableError } from "./errors"

const tokens = { access_token: "at-0", refresh_token: "rt-0", expires_in: 14_400, token_type: "Bearer" }

describe("token age", () => {
  it("counts expiry from obtainedAt, not from manager construction", async () => {
    const now = 10 * 3_600_000
    const refresh = vi.fn(async () => ({ ...tokens, access_token: "at-1" }))
    const manager = createTokenManager(
      { clientId: "c", clientSecret: "s", tokens, obtainedAt: now - 4 * 3_600_000, now: () => now },
      refresh as unknown as typeof refreshAccessToken
    )
    expect(await manager.getAccessToken()).toBe("at-1")
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it("persists rotated tokens with the time they were obtained", async () => {
    const now = 5_000
    const set = vi.fn()
    const manager = createTokenManager(
      {
        clientId: "c",
        clientSecret: "s",
        tokens,
        obtainedAt: 0,
        now: () => now + 14_400_000,
        store: { get: () => undefined, set },
      },
      (async () => ({ ...tokens, access_token: "at-2", refresh_token: "rt-2" })) as typeof refreshAccessToken
    )
    await manager.getAccessToken()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ refresh_token: "rt-2" }), now + 14_400_000)
  })
})

describe("token endpoint", () => {
  it("never retries a refresh (a rotated refresh token must not be burned)", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 503 }))
    await expect(
      refreshAccessToken({ clientId: "c", clientSecret: "s", refreshToken: "rt", fetch: fetch as unknown as FetchLike })
    ).rejects.toBeInstanceOf(RingServiceUnavailableError)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
