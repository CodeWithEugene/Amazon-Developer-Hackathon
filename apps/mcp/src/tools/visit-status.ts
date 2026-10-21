import type { Client, Visit } from "@visitproof/domain"

import type { AgencySettings, VisitRepository } from "../repo"
import { formatLocalDate, partOfDay } from "../time"
import {
  clockOf,
  detailsHidden,
  firstName,
  resolveClient,
  type ToolContext,
} from "./context"
import {
  MAX_SPOKEN_ITEMS,
  countPhrase,
  isLateArrival,
  isUnobservable,
  minutesBetween,
  reasonText,
  spokenTime,
  spokenWindow,
} from "./format"

export type VisitAnswer =
  | "arrived"
  | "no_show"
  | "not_yet_due"
  | "awaiting_arrival"
  | "unobservable"
  | "needs_review"

export interface VisitStatusItem {
  visitId: string
  status: Visit["status"]
  answer: VisitAnswer
  scheduledStart: string
  scheduledEnd: string
  window: string
  arrivalAt?: string
  departureAt?: string
  clockInAt?: string
  /** Named only from the caregiver's own clock-in, never from the door. */
  clockedInBy?: string
  reconciliation?: NonNullable<Visit["reconciliation"]>["outcome"]
  observabilityReasons: string[]
  spoken: string
}

export interface VisitStatusResult {
  spoken: string
  answer: "yes" | "no" | "not_yet" | "unknown"
  clientId?: string
  date?: string
  timeZone?: string
  detailsHidden?: boolean
  visits: VisitStatusItem[]
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const classify = (visit: Visit, now: Date): VisitAnswer => {
  if (isUnobservable(visit)) return "unobservable"
  if (visit.status === "ambiguous") return "needs_review"
  if (visit.arrival) return "arrived"
  if (visit.status === "no_show") return "no_show"
  return now.getTime() < Date.parse(visit.scheduledStart) ? "not_yet_due" : "awaiting_arrival"
}

const arrivedSentence = (visit: Visit, settings: AgencySettings, clockedInBy?: string): string => {
  const tz = settings.timeZone
  const parts = [`someone arrived at the door at ${spokenTime(visit.arrival!.at, tz)}`]
  if (visit.departure) parts.push(`and left at ${spokenTime(visit.departure.at, tz)}`)
  let sentence = `${parts.join(" ")}.`
  if (isLateArrival(visit, settings.tolerances.graceMin)) {
    sentence += ` That was ${minutesBetween(visit.scheduledStart, visit.arrival!.at)} minutes after the scheduled start.`
  }
  if (visit.status === "early_departure") sentence += " The visit ended earlier than scheduled."
  if (visit.status === "departure_not_observed") sentence += " The departure was not observed."
  const clockIn = visit.reconciliation?.clockIn
  if (clockIn) sentence += ` ${clockedInBy ?? "The caregiver"} clocked in at ${spokenTime(clockIn, tz)}.`
  return sentence
}

const sentenceFor = (
  visit: Visit,
  answer: VisitAnswer,
  settings: AgencySettings,
  label: string,
  clockedInBy?: string,
): string => {
  const tz = settings.timeZone
  const window = spokenWindow(visit.scheduledStart, visit.scheduledEnd, tz)
  switch (answer) {
    case "unobservable":
      return `${label} could not be fully observed because ${reasonText(visit.observability.reasons)}.${
        visit.arrival ? ` The door recorded someone arriving at ${spokenTime(visit.arrival.at, tz)} before that.` : ""
      }`
    case "needs_review":
      return `The door record for ${lowerFirst(label)} is ambiguous and needs a person to review it.`
    case "arrived":
      return label === "The visit"
        ? upperFirst(arrivedSentence(visit, settings, clockedInBy))
        : `For ${lowerFirst(label)}, ${arrivedSentence(visit, settings, clockedInBy)}`
    case "no_show":
      return `No one was seen at the door for ${lowerFirst(label)}, scheduled ${window}.`
    case "not_yet_due":
      return `${label} is scheduled for ${window}.`
    case "awaiting_arrival":
      return `No arrival yet for ${lowerFirst(label)}, which started at ${spokenTime(visit.scheduledStart, tz)}.`
  }
}

const caregiverFromClockIn = async (repo: VisitRepository, visit: Visit): Promise<string | undefined> => {
  if (!visit.reconciliation?.clockIn) return undefined
  return (await repo.getCaregiver(visit.caregiverId))?.name
}

const buildItem = async (
  context: ToolContext,
  visit: Visit,
  clock: { now: Date; settings: AgencySettings },
  label: string,
): Promise<VisitStatusItem> => {
  const answer = classify(visit, clock.now)
  const clockedInBy = await caregiverFromClockIn(context.repo, visit)
  return {
    visitId: visit.id,
    status: visit.status,
    answer,
    scheduledStart: visit.scheduledStart,
    scheduledEnd: visit.scheduledEnd,
    window: spokenWindow(visit.scheduledStart, visit.scheduledEnd, clock.settings.timeZone),
    ...(visit.arrival ? { arrivalAt: visit.arrival.at } : {}),
    ...(visit.departure ? { departureAt: visit.departure.at } : {}),
    ...(visit.reconciliation?.clockIn ? { clockInAt: visit.reconciliation.clockIn } : {}),
    ...(clockedInBy ? { clockedInBy } : {}),
    ...(visit.reconciliation ? { reconciliation: visit.reconciliation.outcome } : {}),
    observabilityReasons: [...visit.observability.reasons],
    spoken: sentenceFor(visit, answer, clock.settings, label, clockedInBy),
  }
}

const overallAnswer = (items: readonly VisitStatusItem[]): VisitStatusResult["answer"] => {
  if (items.some((item) => item.answer === "arrived")) return "yes"
  if (items.some((item) => item.answer === "no_show")) return "no"
  if (items.some((item) => item.answer === "not_yet_due" || item.answer === "awaiting_arrival")) return "not_yet"
  return "unknown"
}

const OPENERS: Record<VisitStatusResult["answer"], string> = {
  yes: "Yes.",
  no: "No.",
  not_yet: "Not yet.",
  unknown: "I can't confirm that.",
}

const labelsFor = (visits: readonly Visit[], timeZone: string): string[] => {
  if (visits.length === 1) return ["The visit"]
  const parts = visits.map((visit) => partOfDay(visit.scheduledStart, timeZone))
  return visits.map((visit, index) =>
    parts.filter((part) => part === parts[index]).length === 1
      ? `The ${parts[index]} visit`
      : `The ${spokenTime(visit.scheduledStart, timeZone)} visit`,
  )
}

const hiddenResult = (client: Client, date: string, timeZone: string): VisitStatusResult => ({
  spoken: `${firstName(client.name)}'s family has turned off sharing with the agency, so visit details are hidden.`,
  answer: "unknown",
  clientId: client.id,
  date,
  timeZone,
  detailsHidden: true,
  visits: [],
})

/**
 * get_visit_status: every visit for the client on the date (default today in
 * the agency zone), answered honestly per visit. The door is described as
 * "someone"; a caregiver is named only from their own clock-in.
 */
export async function getVisitStatus(
  args: { clientId?: string; date?: string },
  context: ToolContext,
): Promise<VisitStatusResult> {
  const clock = await clockOf(context)
  const client = await resolveClient(context, args.clientId)
  const date = args.date ?? clock.today
  const tz = clock.settings.timeZone
  if (detailsHidden(context, client)) return hiddenResult(client, date, tz)
  const visits = await context.repo.listVisitsByDate(date, client.id)
  const when = date === clock.today ? "today" : `on ${formatLocalDate(date)}`
  if (visits.length === 0) {
    return { spoken: `No visit is scheduled for ${firstName(client.name)} ${when}.`, answer: "unknown", clientId: client.id, date, timeZone: tz, visits: [] }
  }
  const labels = labelsFor(visits, tz)
  const items = await Promise.all(visits.map((visit, index) => buildItem(context, visit, clock, labels[index] ?? "The visit")))
  const answer = overallAnswer(items)
  const count = visits.length > 1 ? ` ${firstName(client.name)} has ${countPhrase(visits.length, "visit").toLowerCase()} ${when}.` : ""
  const sentences = items.slice(0, MAX_SPOKEN_ITEMS).map((item) => item.spoken)
  const more = items.length > MAX_SPOKEN_ITEMS ? ` And ${items.length - MAX_SPOKEN_ITEMS} more.` : ""
  return {
    spoken: `${OPENERS[answer]}${count} ${sentences.join(" ")}${more}`.trim(),
    answer,
    clientId: client.id,
    date,
    timeZone: tz,
    visits: items,
  }
}
