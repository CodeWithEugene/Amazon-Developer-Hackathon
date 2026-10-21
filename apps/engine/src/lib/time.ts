/**
 * Agency time zone formatting (shared contract C1) for email copy. The
 * helpers are owned by packages/domain/src/time.ts; this module re-exports
 * them so handler imports stay stable.
 */
export { formatLocalTime, localDateKey, zoneAbbreviation } from "@visitproof/domain"
