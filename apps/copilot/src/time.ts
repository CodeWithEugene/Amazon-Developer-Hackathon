/**
 * Agency-local time helpers (shared contract C1). Every user-facing time is
 * rendered in the agency time zone with Intl and an explicit `timeZone`, in
 * 12-hour format with the zone abbreviation ("8:04 AM ET"). "Today" is the
 * calendar date in the agency time zone.
 *
 * The zone-aware primitives come from `@visitproof/domain` (time.ts); this
 * module keeps only the spoken-answer helpers the domain does not provide.
 */
import {
  formatLocalTime as formatLocalTimeWithZone,
  localDateKey as domainLocalDateKey,
  zoneAbbreviation as domainZoneAbbreviation,
} from "@visitproof/domain"

export const DEFAULT_TIME_ZONE = "America/New_York"

/** YYYY-MM-DD of the instant in the given zone. */
export const localDateKey = (iso: string | Date, timeZone: string): string =>
  domainLocalDateKey(typeof iso === "string" ? iso : iso.toISOString(), timeZone)

/** "8:04 AM" in the given zone. */
export const formatLocalTime = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso))

/** Generic zone abbreviation such as "ET" or "PT". */
export const zoneAbbreviation = (iso: string, timeZone: string): string =>
  domainZoneAbbreviation(iso, timeZone)

/** "8:04 AM ET": the spoken form used in every answer. */
export const spokenTime = (iso: string, timeZone: string): string =>
  formatLocalTimeWithZone(iso, timeZone)

/** "Sunday, September 27" for a YYYY-MM-DD local date key. */
export const formatLocalDate = (dateKey: string): string =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${dateKey}T12:00:00Z`))

/** Adds whole days to a YYYY-MM-DD key (calendar arithmetic, zone free). */
export const addDays = (dateKey: string, days: number): string => {
  const date = new Date(`${dateKey}T12:00:00Z`)
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

/** Morning, afternoon, or evening of an instant in the given zone. */
export const partOfDay = (iso: string, timeZone: string): string => {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
      new Date(iso),
    ),
  )
  if (hour < 12) return "morning"
  if (hour < 17) return "afternoon"
  return "evening"
}
