import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

import { isRole, type Role } from "@/lib/roles"

/**
 * Signed demo session tokens: `role.expiresAtMs.hmac`. The HMAC key comes
 * from `VISITPROOF_SESSION_SECRET`, or a random per-process key (sessions
 * then end when the server restarts). A hand-set `vp_role=compliance`
 * cookie no longer grants anything.
 */

export const SESSION_TTL_SECONDS = 60 * 60 * 8

const globalKey = Symbol.for("visitproof.console.sessionSecret")

function secret(): string {
  const configured = process.env.VISITPROOF_SESSION_SECRET
  if (configured) return configured
  const holder = globalThis as { [globalKey]?: string }
  holder[globalKey] ??= randomBytes(32).toString("hex")
  return holder[globalKey]
}

const sign = (payload: string): string =>
  createHmac("sha256", secret()).update(payload).digest("hex")

export function createSessionToken(role: Role, now: Date = new Date()): string {
  const payload = `${role}.${now.getTime() + SESSION_TTL_SECONDS * 1000}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionToken(
  token: string | undefined,
  now: Date = new Date()
): Role | null {
  const [role, expires, signature] = token?.split(".") ?? []
  if (!role || !expires || !signature || !isRole(role)) return null
  if (!(Number(expires) > now.getTime())) return null
  const expected = Buffer.from(sign(`${role}.${expires}`), "hex")
  const given = Buffer.from(signature, "hex")
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null
  }
  return role
}
