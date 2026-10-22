/**
 * Redaction for recorded Playground fixtures (scripts/ring-smoke.ts). Pure
 * and immutable: returns a copy with personal fields (first_name, last_name,
 * email, phone_number) and every token or secret replaced, the Ring account
 * id (a users document's id, or any account_id) swapped for a placeholder,
 * bearer strings scrubbed, and presigned URL signatures removed.
 */

export const REDACTED = "[redacted]"
/** Keeps the documented `ava1.ring.account.` shape so schemas still parse. */
export const REDACTED_ACCOUNT_ID = "ava1.ring.account.PLAYGROUND_REDACTED"

const PERSONAL_KEYS: ReadonlySet<string> = new Set(["first_name", "last_name", "email", "phone_number"])
const SECRET_KEY = /(token|secret|authorization|password|api_?key|signature|credential)/i
const BEARER = /^bearer\s+\S+/i
const SIGNED_QUERY = /[?&](x-amz-|signature=|sig=|token=|expires=)/i

const redactString = (value: string): string => {
  if (BEARER.test(value.trim())) return REDACTED
  if (/^https?:\/\//i.test(value) && SIGNED_QUERY.test(value)) {
    return `${value.slice(0, value.indexOf("?"))}?${REDACTED}`
  }
  return value
}

const shouldRedactKey = (key: string): boolean => PERSONAL_KEYS.has(key) || SECRET_KEY.test(key)

/** The Ring account id is what account linking keys on, so it never leaves the machine. */
const isAccountIdKey = (key: string, isUserResource: boolean): boolean =>
  key === "account_id" || (isUserResource && key === "id")

export const redactFixture = (value: unknown): unknown => {
  if (typeof value === "string") return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactFixture(item))
  if (value === null || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  const isUserResource = record.type === "users"
  return Object.fromEntries(
    Object.entries(record).map(([key, item]) => {
      if (shouldRedactKey(key)) return [key, REDACTED]
      if (isAccountIdKey(key, isUserResource) && typeof item === "string") return [key, REDACTED_ACCOUNT_ID]
      return [key, redactFixture(item)]
    })
  )
}
