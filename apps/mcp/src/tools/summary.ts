import type { Visit } from "@visitproof/domain"

import { addDays, formatLocalDate, localDateKey } from "../time"
import { clockOf, detailsHidden, firstName, resolveClient, type ToolContext } from "./context"
import { isLateArrival, isUnobservable, minutesBetween, spokenList, spokenTime } from "./format"

export const SUMMARY_RANGES = { week: 7, two_weeks: 14, month: 30 } as const
export type SummaryRange = keyof typeof SUMMARY_RANGES

export interface ClientSummaryResult {
  spoken: string
  clientId?: string
  from?: string
  to?: string
  detailsHidden?: boolean
  counts?: {
    scheduled: number
    due: number
    onTime: number
    late: number
    noShow: number
    unobservable: number
    earlyDeparture: number
    corroborated: number
  }
  lateVisits?: Array<{ visitId: string; scheduledStart: string; arrivalAt: string; minutesLate: number }>
}

const countsFor = (visits: readonly Visit[], now: Date, graceMin: number) => {
  const due = visits.filter((visit) => Date.parse(visit.scheduledStart) <= now.getTime())
  const observable = due.filter((visit) => !isUnobservable(visit))
  return {
    scheduled: visits.length,
    due: due.length,
    onTime: observable.filter((visit) => visit.arrival && !isLateArrival(visit, graceMin)).length,
    late: observable.filter((visit) => isLateArrival(visit, graceMin)).length,
    noShow: due.filter((visit) => visit.status === "no_show").length,
    unobservable: due.filter(isUnobservable).length,
    earlyDeparture: due.filter((visit) => visit.status === "early_departure").length,
    corroborated: due.filter((visit) => visit.reconciliation?.outcome === "corroborated").length,
  }
}

const lateLine = (visit: { scheduledStart: string; minutesLate: number }, timeZone: string): string =>
  `${formatLocalDate(localDateKey(visit.scheduledStart, timeZone)).split(",")[0]} at ${spokenTime(visit.scheduledStart, timeZone)}, ${visit.minutesLate} minutes late`

/** get_client_summary: door reliability for one client over a range. */
export async function getClientSummary(
  args: { clientId?: string; range?: SummaryRange },
  context: ToolContext,
): Promise<ClientSummaryResult> {
  const clock = await clockOf(context)
  const client = await resolveClient(context, args.clientId)
  if (detailsHidden(context, client)) {
    return { spoken: `${firstName(client.name)}'s family has turned off sharing with the agency, so the summary is hidden.`, clientId: client.id, detailsHidden: true }
  }
  const days = SUMMARY_RANGES[args.range ?? "week"]
  const to = clock.today
  const from = addDays(to, -(days - 1))
  const tz = clock.settings.timeZone
  const grace = clock.settings.tolerances.graceMin
  const visits = await context.repo.listVisitsInRange(from, to, client.id)
  const counts = countsFor(visits, clock.now, grace)
  const lateVisits = visits
    .filter((visit) => !isUnobservable(visit) && isLateArrival(visit, grace))
    .map((visit) => ({ visitId: visit.id, scheduledStart: visit.scheduledStart, arrivalAt: visit.arrival!.at, minutesLate: minutesBetween(visit.scheduledStart, visit.arrival!.at) }))
  const name = firstName(client.name)
  const head = `Over the last ${days} days, ${name} had ${counts.due} visits so far.`
  const body = `${counts.onTime} arrived on time, ${counts.late} arrived late, ${counts.noShow} had no one at the door, and ${counts.unobservable} could not be observed.`
  const late = lateVisits.length > 0 ? ` Late: ${spokenList(lateVisits.map((visit) => lateLine(visit, tz)))}.` : ""
  return { spoken: `${head} ${body}${late}`, clientId: client.id, from, to, counts, lateVisits }
}
