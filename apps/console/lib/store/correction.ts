import type { ExceptionKind, Visit } from "@visitproof/domain"

import { reasonLabel } from "@/lib/labels"
import {
  formatDateKey,
  formatLocalTimeZoned,
  localDateKey,
  localWallTimeToIso,
} from "@/lib/time"

import { ValidationError } from "./errors"

/**
 * Agency corrections ("Backfill Times", contract C2), pure. A correction is
 * the agency's statement of what happened; it never replaces the door's
 * observed arrival or departure, which only the Presence Engine writes.
 */

export interface CorrectionInput {
  /** ISO instants (kept for API compatibility). */
  arrivalAt?: string
  departureAt?: string
  /** Agency-local wall times ("HH:MM") on the visit's local day. */
  arrivalLocal?: string
  departureLocal?: string
  reason?: string
  note?: string
  /** The exception card the correction answers, when known. */
  exceptionId?: string
}

export interface PlannedCorrection {
  visitDay: string
  arrivalAt?: string
  departureAt?: string
}

/** Exception kinds a confirmed time answers; review kinds stay open. */
export const CORRECTABLE_KINDS: readonly ExceptionKind[] = [
  "late_no_arrival",
  "late_arrival",
  "no_show",
  "unobservable",
  "early_departure",
]

/** Clock skew allowed for "not in the future". */
const FUTURE_SKEW_MS = 5 * 60_000

function toInstant(
  iso: string | undefined,
  local: string | undefined,
  visitDay: string,
  timeZone: string
): string | undefined {
  if (local) return localWallTimeToIso(visitDay, local, timeZone)
  return iso ? new Date(iso).toISOString() : undefined
}

function checkInstant(
  label: string,
  iso: string,
  visitDay: string,
  timeZone: string,
  now: Date
): void {
  if (localDateKey(iso, timeZone) !== visitDay) {
    throw new ValidationError(
      `The ${label} must fall on the visit day, ${formatDateKey(visitDay)}.`
    )
  }
  if (Date.parse(iso) > now.getTime() + FUTURE_SKEW_MS) {
    throw new ValidationError(`The ${label} cannot be in the future.`)
  }
}

/** Validates and resolves a correction against the visit, in agency time. */
export function planCorrection(
  visit: Visit,
  input: CorrectionInput,
  timeZone: string,
  now: Date
): PlannedCorrection {
  const visitDay = localDateKey(visit.scheduledStart, timeZone)
  const arrivalAt = toInstant(input.arrivalAt, input.arrivalLocal, visitDay, timeZone)
  const departureAt = toInstant(
    input.departureAt,
    input.departureLocal,
    visitDay,
    timeZone
  )
  if (!arrivalAt && !departureAt) {
    throw new ValidationError("Enter an arrival time, a departure time, or both.")
  }
  if (arrivalAt) checkInstant("arrival", arrivalAt, visitDay, timeZone, now)
  if (departureAt) checkInstant("departure", departureAt, visitDay, timeZone, now)
  const start = arrivalAt ?? visit.arrival?.at
  const end = departureAt ?? visit.departure?.at
  if (start && end && Date.parse(end) <= Date.parse(start)) {
    throw new ValidationError("The departure must be after the arrival.")
  }
  return {
    visitDay,
    ...(arrivalAt ? { arrivalAt } : {}),
    ...(departureAt ? { departureAt } : {}),
  }
}

/** Plain-language text for the agency note in the Resolved column. */
export function correctionText(
  plan: PlannedCorrection,
  reason: string,
  timeZone: string
): string {
  const parts = [
    plan.arrivalAt ? `arrival ${formatLocalTimeZoned(plan.arrivalAt, timeZone)}` : null,
    plan.departureAt
      ? `departure ${formatLocalTimeZoned(plan.departureAt, timeZone)}`
      : null,
  ].filter((part): part is string => part !== null)
  return (
    `Agency correction for ${formatDateKey(plan.visitDay)}: ${parts.join(", ")}. ` +
    `Reason: ${reasonLabel(reason)}. The door observations were kept unchanged.`
  )
}
