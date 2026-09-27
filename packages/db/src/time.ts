import { monotonicFactory } from "ulidx"

/** Injected clock so every repository and store is testable. */
export type Clock = () => Date

export const systemClock: Clock = () => new Date()

export type IdFactory = () => string

const monotonicUlid = monotonicFactory()

/** Lexically sortable, collision-free ids (ULID). */
export const newId: IdFactory = () => monotonicUlid()

export const SECONDS = Object.freeze({
  minute: 60,
  hour: 3_600,
  day: 86_400,
} as const)

export const toEpochSeconds = (date: Date): number =>
  Math.floor(date.getTime() / 1_000)

/** TTL attribute value for `seconds` after `now`. */
export const ttlAt = (now: Date, seconds: number): number =>
  toEpochSeconds(now) + seconds

const ISO_DATE_LENGTH = 10

/** The calendar date (yyyy-mm-dd) of an instant in the given IANA time zone. */
export const dateInTimeZone = (iso: string, timeZone: string): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return formatter.format(new Date(iso)).slice(0, ISO_DATE_LENGTH)
}

/** yyyy-mm-dd of a UTC ISO timestamp, used for UTC-keyed sort keys. */
export const utcDateOf = (iso: string): string => iso.slice(0, ISO_DATE_LENGTH)
