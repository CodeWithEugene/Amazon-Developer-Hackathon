import type { ObservabilityReason, Visit } from "@visitproof/domain"

import { formatLocalTime, spokenTime, zoneAbbreviation } from "../time"

/** Voice answers name at most this many items (build.md Section 8.1). */
export const MAX_SPOKEN_ITEMS = 5

/** "a, b, and c" with at most five items and an "and N more" tail. */
export const spokenList = (items: readonly string[], noun = "more"): string => {
  const shown = items.slice(0, MAX_SPOKEN_ITEMS)
  const rest = items.length - shown.length
  const parts = rest > 0 ? [...shown, `${rest} ${noun}`] : shown
  if (parts.length <= 1) return parts.join("")
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`
}

export const plural = (count: number, one: string, many = `${one}s`): string =>
  `${count} ${count === 1 ? one : many}`

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"]

/** "Two visits" for small counts, "12 visits" otherwise. */
export const countPhrase = (count: number, one: string, many = `${one}s`): string =>
  `${NUMBER_WORDS[count] ?? String(count)} ${count === 1 ? one : many}`

const STATUS_LABELS: Record<Visit["status"], string> = {
  scheduled: "scheduled",
  awaiting_arrival: "awaiting arrival",
  arrived_on_time: "arrived on time",
  arrived_late: "arrived late",
  no_show: "no show",
  in_progress: "in progress",
  completed: "completed",
  early_departure: "ended early",
  departure_not_observed: "departure not observed",
  unobservable: "could not be observed",
  ambiguous: "needs review",
}

export const statusLabel = (status: Visit["status"]): string => STATUS_LABELS[status]

const REASONS: Record<ObservabilityReason, string> = {
  device_offline: "the doorbell was offline",
  no_front_door_device: "no front door device is shared",
  motion_recording_off: "motion recording is off in the Ring app",
  no_motion_zone: "no motion zone covers the walkway",
  encrypted_device: "the doorbell uses end-to-end encryption",
  integration_removed: "Ring access was removed",
  integration_paused: "Ring sharing is paused",
  consent_withdrawn: "the family withdrew consent",
}

export const reasonText = (reasons: readonly ObservabilityReason[]): string =>
  reasons.length === 0 ? "the door record is incomplete" : spokenList(reasons.map((reason) => REASONS[reason]))

/** "8:00 to 10:00 AM ET" (or "11:30 AM to 1:30 PM ET"). */
export const spokenWindow = (start: string, end: string, timeZone: string): string => {
  const from = formatLocalTime(start, timeZone)
  const to = formatLocalTime(end, timeZone)
  const zone = zoneAbbreviation(end, timeZone)
  const [fromClock, fromPeriod] = from.split(" ")
  const [, toPeriod] = to.split(" ")
  return fromPeriod === toPeriod ? `${fromClock} to ${to} ${zone}` : `${from} to ${to} ${zone}`
}

export { spokenTime }

export const minutesBetween = (fromIso: string, toIso: string): number =>
  Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)

/** Door arrival later than scheduled start plus the grace window. */
export const isLateArrival = (visit: Visit, graceMin: number): boolean =>
  Boolean(visit.arrival) && minutesBetween(visit.scheduledStart, visit.arrival!.at) > graceMin

export const isUnobservable = (visit: Visit): boolean =>
  visit.observability.state === "unobservable" || visit.status === "unobservable"
