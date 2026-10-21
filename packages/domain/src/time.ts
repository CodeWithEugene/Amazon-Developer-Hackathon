/**
 * Agency time zone helpers (shared contract C1). Every user-facing time is
 * rendered in the agency time zone with an explicit `timeZone`, in 12-hour
 * format with the zone abbreviation ("8:04 AM ET"). "Today" is the calendar
 * date in the agency time zone. Pure: no ambient clock or locale.
 */

const LOCALE = "en-US"
/** Longest generic abbreviation accepted before falling back to the offset form. */
const MAX_GENERIC_ABBREVIATION_LENGTH = 5
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseInstant(iso: string): Date {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new RangeError(`Invalid ISO timestamp: ${iso}`)
  return new Date(ms)
}

function partsOf(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Record<string, string> {
  const parts = new Intl.DateTimeFormat(LOCALE, { timeZone, ...options }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value]))
}

/**
 * Short zone label for an instant: the generic abbreviation when Intl has a
 * compact one ("ET", "PT"), otherwise the short form ("UTC", "GMT+2").
 */
export function zoneAbbreviation(iso: string, timeZone: string): string {
  const date = parseInstant(iso)
  const generic = partsOf(date, timeZone, { timeZoneName: "shortGeneric" }).timeZoneName
  const compact =
    generic !== undefined &&
    !generic.startsWith("GMT") &&
    !/\s/.test(generic) &&
    generic.length <= MAX_GENERIC_ABBREVIATION_LENGTH
  if (compact) {
    return generic
  }
  return partsOf(date, timeZone, { timeZoneName: "short" }).timeZoneName ?? timeZone
}

/** "8:04 AM ET": 12-hour wall-clock time in the zone, with its abbreviation. */
export function formatLocalTime(iso: string, timeZone: string): string {
  const date = parseInstant(iso)
  const parts = partsOf(date, timeZone, { hour: "numeric", minute: "2-digit", hour12: true })
  return `${parts.hour}:${parts.minute} ${parts.dayPeriod} ${zoneAbbreviation(iso, timeZone)}`
}

/** "Thu, Oct 1, 2026": the calendar date of the instant in the zone. */
export function formatLocalDate(iso: string, timeZone: string): string {
  const date = parseInstant(iso)
  const parts = partsOf(date, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`
}

/** "2026-10-01": the calendar date of the instant in the zone (YYYY-MM-DD). */
export function localDateKey(iso: string, timeZone: string): string {
  const date = parseInstant(iso)
  const parts = partsOf(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" })
  return `${parts.year}-${parts.month}-${parts.day}`
}

/** Offset of the zone from UTC at an instant, in milliseconds (east positive). */
function zoneOffsetMs(ms: number, timeZone: string): number {
  const parts = partsOf(new Date(ms), timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  })
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  )
  return asUtc - Math.floor(ms / 1000) * 1000
}

/**
 * The UTC instant for a local wall-clock time on a local date, e.g. 9:00 AM
 * on 2026-11-02 in America/New_York is "2026-11-02T14:00:00.000Z". A
 * repeated fall-back wall time resolves to its first occurrence.
 */
export function zonedTimeToIso(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string
): string {
  const match = DATE_KEY_PATTERN.exec(dateKey)
  if (!match) throw new RangeError(`Invalid date key: ${dateKey}`)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError(`Invalid hour: ${hour}`)
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`Invalid minute: ${minute}`)
  }
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute)
  let guess = wall - zoneOffsetMs(wall, timeZone)
  const refined = wall - zoneOffsetMs(guess, timeZone)
  if (refined !== guess) guess = refined
  return new Date(guess).toISOString()
}
