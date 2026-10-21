import {
  DEFAULT_TIME_ZONE,
  formatDateKey,
  formatLocalTime,
  formatLocalTimeZoned,
} from "@/lib/time"

/**
 * Display formatters. Every time is rendered in the agency time zone
 * (contract C1); callers pass `agency.timezone`, and the demo agency's zone
 * is the default so a missing argument never falls back to server time.
 */

/** Formats an ISO datetime as a short agency-local time, e.g. 10:41 AM. */
export function formatTime(
  iso: string | undefined,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  if (!iso) return "not observed"
  return formatLocalTime(iso, timeZone)
}

/** Formats a window, e.g. 7:00 AM to 9:00 AM ET. */
export function formatWindow(
  start: string,
  end: string,
  timeZone: string = DEFAULT_TIME_ZONE
): string {
  return `${formatLocalTime(start, timeZone)} to ${formatLocalTimeZoned(end, timeZone)}`
}

/** Formats a YYYY-MM-DD date key as a long date, e.g. September 27, 2026. */
export function formatDate(dateKey: string): string {
  return formatDateKey(dateKey)
}
