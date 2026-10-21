/**
 * Agency time zone helpers (shared contract C1). Every user-facing time is
 * rendered in the agency time zone with an explicit `timeZone`, in 12-hour
 * format, so server and client render the same string. "Today" is the
 * calendar date in the agency time zone.
 *
 * These mirror the helpers planned for packages/domain/src/time.ts
 * (formatLocalTime, formatLocalDate, localDateKey, zoneAbbreviation); the
 * console keeps a local copy so it does not depend on that module landing.
 */

export const DEFAULT_TIME_ZONE = "America/New_York"

const DAY_MS = 86_400_000

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${timeZone}|${JSON.stringify(options)}`
  const cached = formatterCache.get(key)
  if (cached) return cached
  const created = new Intl.DateTimeFormat("en-US", { ...options, timeZone })
  formatterCache.set(key, created)
  return created
}

const toDate = (iso: string | Date): Date =>
  iso instanceof Date ? iso : new Date(iso)

/** Short generic zone name, for example "ET" for America/New_York. */
export function zoneAbbreviation(iso: string | Date, timeZone: string): string {
  const parts = formatter(timeZone, {
    hour: "numeric",
    timeZoneName: "shortGeneric",
  }).formatToParts(toDate(iso))
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone
}

/** 12-hour local time, for example "8:04 AM". */
export function formatLocalTime(iso: string | Date, timeZone: string): string {
  return formatter(timeZone, { hour: "numeric", minute: "2-digit" }).format(
    toDate(iso)
  )
}

/** 12-hour local time with the zone, for example "8:04 AM ET". */
export function formatLocalTimeZoned(
  iso: string | Date,
  timeZone: string
): string {
  return `${formatLocalTime(iso, timeZone)} ${zoneAbbreviation(iso, timeZone)}`
}

/** Long local date, for example "September 14, 2026". */
export function formatLocalDate(iso: string | Date, timeZone: string): string {
  return formatter(timeZone, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(toDate(iso))
}

/** Local date with weekday, for example "Monday, September 14". */
export function formatLocalWeekday(
  iso: string | Date,
  timeZone: string
): string {
  return formatter(timeZone, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(toDate(iso))
}

/** Short local date and time, for example "Sep 14, 8:04 AM". */
export function formatLocalDateTime(
  iso: string | Date,
  timeZone: string
): string {
  return formatter(timeZone, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(iso))
}

/** Calendar date in the time zone as YYYY-MM-DD. */
export function localDateKey(iso: string | Date, timeZone: string): string {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(toDate(iso))
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Adds whole days to a YYYY-MM-DD key (calendar arithmetic, zone free). */
export function addDaysToKey(dateKey: string, days: number): string {
  const base = Date.parse(`${dateKey}T12:00:00Z`)
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10)
}

/** Long date for a YYYY-MM-DD key, for example "September 14, 2026". */
export function formatDateKey(dateKey: string): string {
  return formatLocalDate(`${dateKey}T12:00:00Z`, "UTC")
}

/** Weekday date for a YYYY-MM-DD key, for example "Monday, September 14". */
export function formatDateKeyWeekday(dateKey: string): string {
  return formatLocalWeekday(`${dateKey}T12:00:00Z`, "UTC")
}

/** Offset of the zone from UTC at an instant, in milliseconds. */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMs))
  const get = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

const WALL_TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

/**
 * Converts an agency-local wall time ("HH:MM") on a local date
 * ("YYYY-MM-DD") to a UTC ISO instant. Handles DST by re-checking the
 * offset at the candidate instant.
 */
export function localWallTimeToIso(
  dateKey: string,
  wallTime: string,
  timeZone: string
): string {
  const match = WALL_TIME.exec(wallTime)
  const [year, month, day] = dateKey.split("-").map(Number)
  if (!match || !year || !month || !day) {
    throw new RangeError(`Invalid local time ${dateKey} ${wallTime}`)
  }
  const guess = Date.UTC(year, month - 1, day, Number(match[1]), Number(match[2]))
  const first = guess - zoneOffsetMs(guess, timeZone)
  const second = guess - zoneOffsetMs(first, timeZone)
  return new Date(second).toISOString()
}

/** "HH:MM" (24-hour) wall time of an instant in the zone, for inputs. */
export function localWallTime(iso: string | Date, timeZone: string): string {
  const parts = formatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(iso))
  const get = (type: string): string =>
    parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("hour")}:${get("minute")}`
}
