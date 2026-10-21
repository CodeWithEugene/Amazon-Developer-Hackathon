import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

/**
 * Token encryption at rest. `TokenCipher` is the seam KMS envelope
 * encryption replaces in production; locally it is AES-256-GCM keyed by
 * VISITPROOF_TOKEN_KEY (32 bytes, base64). Payload format:
 * `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts), so a payload
 * sealed with another key fails with a clear error instead of garbage.
 */

export interface TokenCipher {
  readonly keyId: string
  encrypt(plaintext: string): Promise<string>
  decrypt(payload: string): Promise<string>
}

export class TokenKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TokenKeyError"
  }
}

const IV_BYTES = 12
const KEY_BYTES = 32

const b64u = (buffer: Buffer): string => buffer.toString("base64url")
const fromB64u = (value: string): Buffer => Buffer.from(value, "base64url")

export const keyIdFor = (key: Buffer): string =>
  `local-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`

export const parseTokenKey = (base64: string): Buffer => {
  const key = Buffer.from(base64, "base64")
  if (key.length !== KEY_BYTES) {
    throw new TokenKeyError(`VISITPROOF_TOKEN_KEY must be ${KEY_BYTES} bytes of base64 (got ${key.length} bytes)`)
  }
  return key
}

export const createAesGcmCipher = (key: Buffer): TokenCipher => {
  if (key.length !== KEY_BYTES) throw new TokenKeyError(`AES-256-GCM needs a ${KEY_BYTES} byte key`)
  const keyId = keyIdFor(key)
  return {
    keyId,
    encrypt: async (plaintext) => {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv("aes-256-gcm", key, iv)
      const sealed = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      return ["v1", keyId, b64u(iv), b64u(cipher.getAuthTag()), b64u(sealed)].join(".")
    },
    decrypt: async (payload) => {
      const [version, payloadKeyId, iv, tag, sealed] = payload.split(".")
      if (version !== "v1" || !iv || !tag || sealed === undefined) throw new TokenKeyError("Unrecognized token payload")
      if (payloadKeyId !== keyId) {
        throw new TokenKeyError("Token was sealed with a different VISITPROOF_TOKEN_KEY; link the Ring account again")
      }
      const decipher = createDecipheriv("aes-256-gcm", key, fromB64u(iv))
      decipher.setAuthTag(fromB64u(tag))
      return Buffer.concat([decipher.update(fromB64u(sealed)), decipher.final()]).toString("utf8")
    },
  }
}

const RANDOM_KEY = Symbol.for("visitproof.console.ringTokenKey")

/**
 * The console's cipher: VISITPROOF_TOKEN_KEY when set, otherwise a random
 * per-process demo key (tokens then do not survive a restart) with a
 * one-time warning.
 */
export const tokenCipherFromEnv = (
  tokenKey: string | undefined,
  warn: (message: string) => void
): TokenCipher => {
  if (tokenKey) return createAesGcmCipher(parseTokenKey(tokenKey))
  const holder = globalThis as { [RANDOM_KEY]?: Buffer }
  if (!holder[RANDOM_KEY]) {
    holder[RANDOM_KEY] = randomBytes(KEY_BYTES)
    warn("VISITPROOF_TOKEN_KEY is not set; using a random demo key. Linked Ring tokens will not survive a restart.")
  }
  return createAesGcmCipher(holder[RANDOM_KEY])
}
