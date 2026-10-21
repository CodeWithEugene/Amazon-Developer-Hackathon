import type { Client, Exception, Visit } from "@visitproof/domain"

import { addDays, formatLocalDate, localDateKey } from "../time"
import { agencyMaySee, clockOf, firstName, requireAgency, type ToolContext } from "./context"
import { MAX_SPOKEN_ITEMS, spokenList, spokenTime } from "./format"

const EXCEPTION_SEVERITY: Record<Exception["kind"], number> = {
  no_show: 0,
  contradicted: 1,
  late_no_arrival: 2,
  late_arrival: 3,
  early_departure: 4,
  missing_clock_in: 5,
  unobservable: 6,
  ambiguous: 7,
}

const KIND_LABELS: Record<Exception["kind"], string> = {
  no_show: "no-show",
  contradicted: "clock-in contradicts the door",
  late_no_arrival: "no arrival yet",
  late_arrival: "late arrival",
  early_departure: "early departure",
  missing_clock_in: "missing clock-in",
  unobservable: "visit could not be observed",
  ambiguous: "needs review",
}

export interface ExceptionSummary {
  exceptionId: string
  visitId: string
  clientId: string
  clientFirstName?: string
  kind: Exception["kind"]
  state: Exception["state"]
  openedAt: string
  scheduledStart?: string
  detailsHidden: boolean
}

/** "any" lists every state (for questions like who was late this week). */
export type ExceptionStateFilter = Exception["state"] | "any"

export interface ExceptionsResult {
  spoken: string
  count: number
  from: string
  to: string
  timeZone: string
  state: ExceptionStateFilter
  exceptions: ExceptionSummary[]
}

export interface ListExceptionsArgs {
  date?: string
  state?: ExceptionStateFilter
  kind?: Exception["kind"]
  /** Days to look back including the date (1 = just that day, 7 = a week). */
  days?: number
}

const summarize = (exception: Exception, visit: Visit | undefined, client: Client | undefined): ExceptionSummary => {
  const hidden = client ? !agencyMaySee(client) : false
  return {
    exceptionId: exception.id,
    visitId: exception.visitId,
    clientId: exception.clientId,
    ...(client ? { clientFirstName: firstName(client.name) } : {}),
    kind: exception.kind,
    state: exception.state,
    openedAt: exception.openedAt,
    ...(visit && !hidden ? { scheduledStart: visit.scheduledStart } : {}),
    detailsHidden: hidden,
  }
}

const spokenItem = (item: ExceptionSummary, timeZone: string, withDay: boolean): string => {
  const who = item.clientFirstName ?? "a client"
  if (item.detailsHidden || !item.scheduledStart) return `${KIND_LABELS[item.kind]} for ${who}`
  const day = withDay ? ` on ${formatLocalDate(localDateKey(item.scheduledStart, timeZone)).split(",")[0]}` : ""
  return `${KIND_LABELS[item.kind]} for ${who}${day} at ${spokenTime(item.scheduledStart, timeZone)}`
}

/**
 * list_exceptions: exceptions for visits scheduled in the window (default
 * today, open only), ranked by severity. Counts use the visit's local date,
 * never the time the engine opened the card.
 */
export async function listExceptions(args: ListExceptionsArgs, context: ToolContext): Promise<ExceptionsResult> {
  requireAgency(context, "review the exception queue")
  const clock = await clockOf(context)
  const tz = clock.settings.timeZone
  const to = args.date ?? clock.today
  const from = addDays(to, -((args.days ?? 1) - 1))
  const state = args.state ?? "open"
  const [visits, clients, all] = await Promise.all([
    context.repo.listVisitsInRange(from, to),
    context.repo.listClients(),
    context.repo.listExceptions(undefined, state === "any" ? undefined : state),
  ])
  const visitsById = new Map(visits.map((visit) => [visit.id, visit]))
  const clientsById = new Map(clients.map((client) => [client.id, client]))
  const items = all
    .filter((exception) => visitsById.has(exception.visitId))
    .filter((exception) => !args.kind || exception.kind === args.kind)
    .sort((a, b) => EXCEPTION_SEVERITY[a.kind] - EXCEPTION_SEVERITY[b.kind] || a.openedAt.localeCompare(b.openedAt))
    .map((exception) => summarize(exception, visitsById.get(exception.visitId), clientsById.get(exception.clientId)))
  const span = from === to ? (to === clock.today ? "today" : `on ${formatLocalDate(to)}`) : `in the last ${args.days} days`
  const label = `${state === "any" ? "" : `${state} `}${args.kind ? `${KIND_LABELS[args.kind]} ` : ""}exception`
  if (items.length === 0) {
    return { spoken: `No ${label}s ${span}.${state === "open" ? " Everything looks on track." : ""}`, count: 0, from, to, timeZone: tz, state, exceptions: [] }
  }
  const headline = items.length === 1 ? `There is 1 ${label} ${span}.` : `There are ${items.length} ${label}s ${span}.`
  const lead = items.length > MAX_SPOKEN_ITEMS ? "Most urgent" : items.length === 1 ? "It is" : "They are"
  const spoken = `${headline} ${lead}: ${spokenList(items.map((item) => spokenItem(item, tz, from !== to)))}.`
  return { spoken, count: items.length, from, to, timeZone: tz, state, exceptions: items }
}
