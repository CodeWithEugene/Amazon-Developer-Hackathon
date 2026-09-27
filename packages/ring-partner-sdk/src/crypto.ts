import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"

/**
 * Small, dependency-free crypto helpers shared by webhook verification, the
 * account link nonce, and the emulator's webhook signer. Server side only.
 */

const encoder = new TextEncoder()

export const utf8 = (value: string): Uint8Array => encoder.encode(value)

export const hmacSha256 = (key: string, message: Uint8Array): Uint8Array =>
  Uint8Array.from(createHmac("sha256", key).update(message).digest())

export const hmacSha256Hex = (key: string, message: Uint8Array): string =>
  createHmac("sha256", key).update(message).digest("hex")

export const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")

export const fromHex = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null
  return Uint8Array.from(Buffer.from(hex, "hex"))
}

/**
 * Constant-time comparison. Length mismatches return false without leaking
 * timing on the content, since the length itself is not secret.
 */
export const constantTimeEqualBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && timingSafeEqual(a, b)

export const constantTimeEqualStrings = (a: string, b: string): boolean =>
  constantTimeEqualBytes(utf8(a), utf8(b))

export const newRequestId = (): string => randomUUID()
