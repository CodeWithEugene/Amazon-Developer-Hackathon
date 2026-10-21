/**
 * Wall-clock helpers for the emulator's schedule. Visits are planned at
 * local times in the agency time zone (America/New_York in the demo), which
 * moves with daylight saving; these helpers do that with `Intl` only.
 */

const partsFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })

interface WallParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const wallParts = (epochMs: number, timeZone: string): WallParts => {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(epochMs))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  }
}

/** Offset of `timeZone` from UTC at `epochMs`, in ms (negative west of UTC). */
export const zoneOffsetMs = (epochMs: number, timeZone: string): number => {
  const p = wallParts(epochMs, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(epochMs / 1_000) * 1_000
}

/**
 * Epoch ms of local wall time `hour:minute` on the calendar date
 * (year, month 1-12, day) in `timeZone`.
 */
export const zonedWallTimeToEpoch = (
  date: { readonly year: number; readonly month: number; readonly day: number },
  hour: number,
  minute: number,
  timeZone: string
): number => {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute)
  const first = guess - zoneOffsetMs(guess, timeZone)
  // Re-check at the corrected instant so DST transition days land right.
  return guess - zoneOffsetMs(first, timeZone)
}

const pad = (value: number): string => String(value).padStart(2, "0")

/** `YYYY-MM-DD` of `epochMs` in `timeZone`. */
export const localDateKey = (epochMs: number, timeZone: string): string => {
  const p = wallParts(epochMs, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Ring's `timestamp_readable` shape: `YYYY-MM-DD HH:mm:ss` in `timeZone`. */
export const readableTimestamp = (epochMs: number, timeZone: string): string => {
  const p = wallParts(epochMs, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}
