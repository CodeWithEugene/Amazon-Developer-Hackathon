import { createHmac } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  computeAccountLinkNonce,
  findMatchingAccount,
  isFresh,
  matchNonce,
  nonceMessage,
} from "./nonce"

const KEY = "hmac-signing-key"
const TIME = 1_760_000_000_000
const ACCOUNT = "ava1.ring.account.ABC123"

describe("computeAccountLinkNonce", () => {
  it("is base64url without padding over {time}:{account_id}", () => {
    const expected = createHmac("sha256", KEY)
      .update(`${TIME}:${ACCOUNT}`)
      .digest("base64url")
    const nonce = computeAccountLinkNonce(KEY, TIME, ACCOUNT)
    expect(nonce).toBe(expected)
    expect(nonce).not.toMatch(/[+/=]/)
    expect(nonce).toHaveLength(43)
    expect(nonceMessage(TIME, ACCOUNT)).toBe(`${TIME}:${ACCOUNT}`)
  })

  it("matches a fixed vector", () => {
    expect(computeAccountLinkNonce("k", 1700000000000, "ava1.ring.account.X")).toBe(
      createHmac("sha256", "k").update("1700000000000:ava1.ring.account.X").digest("base64url")
    )
  })

  it("changes with any input", () => {
    const base = computeAccountLinkNonce(KEY, TIME, ACCOUNT)
    expect(computeAccountLinkNonce(KEY, TIME + 1, ACCOUNT)).not.toBe(base)
    expect(computeAccountLinkNonce(KEY, TIME, `${ACCOUNT}x`)).not.toBe(base)
    expect(computeAccountLinkNonce(`${KEY}x`, TIME, ACCOUNT)).not.toBe(base)
  })
})

describe("isFresh", () => {
  it("accepts links up to 600 seconds old and rejects older or future ones", () => {
    expect(isFresh(TIME, TIME)).toBe(true)
    expect(isFresh(TIME, TIME + 600_000)).toBe(true)
    expect(isFresh(TIME, TIME + 600_001)).toBe(false)
    expect(isFresh(TIME + 1, TIME)).toBe(false)
    expect(isFresh(TIME + 1, TIME, 600, 5)).toBe(true)
    expect(isFresh(Number.NaN, TIME)).toBe(false)
  })

  it("honors a custom window", () => {
    expect(isFresh(TIME, TIME + 30_000, 10)).toBe(false)
  })
})

describe("matchNonce and findMatchingAccount", () => {
  it("matches only the exact nonce", () => {
    const nonce = computeAccountLinkNonce(KEY, TIME, ACCOUNT)
    expect(matchNonce(nonce, nonce)).toBe(true)
    expect(matchNonce(nonce, `${nonce}A`)).toBe(false)
    expect(matchNonce(nonce, nonce.slice(0, -1) + (nonce.endsWith("A") ? "B" : "A"))).toBe(false)
  })

  it("finds the account among unclaimed tokens", () => {
    const nonce = computeAccountLinkNonce(KEY, TIME, ACCOUNT)
    const accounts = ["ava1.ring.account.OTHER", ACCOUNT, "ava1.ring.account.Z"]
    expect(findMatchingAccount(KEY, nonce, TIME, accounts)).toBe(ACCOUNT)
    expect(findMatchingAccount(KEY, nonce, TIME + 1, accounts)).toBeUndefined()
    expect(findMatchingAccount(KEY, nonce, TIME, [])).toBeUndefined()
  })
})
