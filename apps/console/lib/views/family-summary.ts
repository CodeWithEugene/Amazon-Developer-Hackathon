import type { Exception, ExceptionKind, Visit } from "@visitproof/domain"

/**
 * Pure rules for the family's calm daily message: which status to show,
 * what the day's headline says, and which single alert (if any) interrupts.
 */

/**
 * The family never sees "Unobservable" next to an observed arrival. With no
 * departure, the visit reads as in progress until its window ends, then as
 * departure not observed (never "in progress" hours later).
 */
export function familyStatus(visit: Visit, now?: Date): Visit["status"] {
  return observedStatus(
    {
      status: visit.status,
      arrived: Boolean(visit.arrival),
      departed: Boolean(visit.departure),
      scheduledEnd: visit.scheduledEnd,
    },
    now
  )
}

/** The facts `observedStatus` needs, so a tool payload can use the same rule. */
export interface StatusFacts<S extends string> {
  readonly status: S
  readonly arrived: boolean
  readonly departed: boolean
  readonly scheduledEnd: string
}

/** Same rule as `familyStatus`, for any surface that shows a visit status. */
export function observedStatus<S extends string>(
  facts: StatusFacts<S>,
  now?: Date
): S | "completed" | "in_progress" | "departure_not_observed" {
  if (facts.status !== "unobservable" || !facts.arrived) return facts.status
  if (facts.departed) return "completed"
  const ended = now !== undefined && now.getTime() > Date.parse(facts.scheduledEnd)
  return ended ? "departure_not_observed" : "in_progress"
}

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]

/** "both visits" for two, "all three visits" up to ten, digits beyond that. */
function allVisitsPhrase(count: number): string {
  if (count === 2) return "both visits"
  return `all ${COUNT_WORDS[count] ?? String(count)} visits`
}

export function dayHeadline(visits: readonly Visit[], now: Date): string {
  if (visits.length === 0) return "No visit is scheduled"
  const arrived = visits.filter((v) => v.arrival).length
  if (arrived === visits.length) {
    return visits.length === 1
      ? "The caregiver came"
      : `The caregiver came for ${allVisitsPhrase(visits.length)}`
  }
  if (arrived > 0) return `${arrived} of ${visits.length} visits observed so far`
  const upcoming = visits.every((v) => Date.parse(v.scheduledStart) > now.getTime())
  return upcoming ? "A visit is scheduled" : "No caregiver arrival observed yet"
}

/** Most urgent first; only a no-show uses the destructive tone. */
const ALERT_PRIORITY: readonly ExceptionKind[] = [
  "no_show",
  "late_no_arrival",
  "early_departure",
  "late_arrival",
  "contradicted",
  "missing_clock_in",
  "unobservable",
  "ambiguous",
]

export interface FamilyAlertChoice {
  exception: Exception
  tone: "warning" | "destructive"
}

/** At most one alert for today, from unresolved exceptions on today's visits. */
export function chooseTodayAlert(
  exceptions: readonly Exception[],
  todayVisitIds: ReadonlySet<string>
): FamilyAlertChoice | null {
  const candidates = exceptions
    .filter((e) => e.state !== "resolved" && todayVisitIds.has(e.visitId))
    .sort((a, b) => ALERT_PRIORITY.indexOf(a.kind) - ALERT_PRIORITY.indexOf(b.kind))
  const first = candidates[0]
  if (!first) return null
  return { exception: first, tone: first.kind === "no_show" ? "destructive" : "warning" }
}
