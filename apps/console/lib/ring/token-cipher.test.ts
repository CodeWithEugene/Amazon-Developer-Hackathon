import { describe, expect, it, vi } from "vitest"

import { createAesGcmCipher, parseTokenKey, tokenCipherFromEnv, TokenKeyError } from "./token-cipher"

describe("TokenCipher (AES-256-GCM)", () => {
  const key = Buffer.alloc(32, 1)

  it("round trips and never contains the plaintext", async () => {
    const cipher = createAesGcmCipher(key)
    const sealed = await cipher.encrypt("refresh-token-value")
    expect(sealed.startsWith(`v1.${cipher.keyId}.`)).toBe(true)
    expect(sealed).not.toContain("refresh-token-value")
    expect(await cipher.decrypt(sealed)).toBe("refresh-token-value")
    expect(await cipher.encrypt("x")).not.toBe(await cipher.encrypt("x"))
  })

  it("fails clearly for another key or a tampered payload", async () => {
    const sealed = await createAesGcmCipher(key).encrypt("secret")
    await expect(createAesGcmCipher(Buffer.alloc(32, 2)).decrypt(sealed)).rejects.toBeInstanceOf(TokenKeyError)
    const parts = sealed.split(".")
    const tampered = [...parts.slice(0, 4), Buffer.from("tampered").toString("base64url")].join(".")
    await expect(createAesGcmCipher(key).decrypt(tampered)).rejects.toThrow()
  })

  it("validates VISITPROOF_TOKEN_KEY and falls back to a warned random key", async () => {
    expect(() => parseTokenKey(Buffer.alloc(16).toString("base64"))).toThrow(TokenKeyError)
    expect(parseTokenKey(key.toString("base64"))).toEqual(key)
    const warn = vi.fn()
    const first = tokenCipherFromEnv(undefined, warn)
    const second = tokenCipherFromEnv(undefined, warn)
    expect(first.keyId).toBe(second.keyId)
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    expect(tokenCipherFromEnv(key.toString("base64"), warn).keyId).toBe(createAesGcmCipher(key).keyId)
  })
})
