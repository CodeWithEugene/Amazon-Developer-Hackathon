/**
 * Redaction for recorded Playground fixtures (scripts/ring-smoke.ts). Pure
 * and immutable: returns a copy with personal fields (first_name, last_name,
 * email, phone_number) and every token or secret replaced, bearer strings
 * scrubbed, and presigned URL signatures removed.
 */

export const REDACTED = "[redacted]"

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

export const redactFixture = (value: unknown): unknown => {
  if (typeof value === "string") return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactFixture(item))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      shouldRedactKey(key) ? REDACTED : redactFixture(item),
    ])
  )
}
