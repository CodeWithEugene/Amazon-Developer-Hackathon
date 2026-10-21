import type { Client, Visit } from "@visitproof/domain"

import { formatLocalDate } from "../time"
import {
  clockOf,
  detailsHidden,
  firstName,
  principalOf,
  resolveClient,
  type ToolContext,
} from "./context"
import { countPhrase, spokenList, spokenTime, spokenWindow, statusLabel } from "./format"

export interface VisitListItem {
  visitId: string
  clientId: string
  clientFirstName: string
  status?: Visit["status"]
  scheduledStart?: string
  scheduledEnd?: string
  window?: string
  arrivalAt?: string
  departureAt?: string
  detailsHidden: boolean
}

export interface ListVisitsResult {
  spoken: string
  date: string
  timeZone: string
  count: number
  visits: VisitListItem[]
}

const itemFor = (visit: Visit, client: Client, hidden: boolean, timeZone: string): VisitListItem =>
  hidden
    ? { visitId: visit.id, clientId: client.id, clientFirstName: firstName(client.name), detailsHidden: true }
    : {
        visitId: visit.id,
        clientId: client.id,
        clientFirstName: firstName(client.name),
        status: visit.status,
        scheduledStart: visit.scheduledStart,
        scheduledEnd: visit.scheduledEnd,
        window: spokenWindow(visit.scheduledStart, visit.scheduledEnd, timeZone),
        ...(visit.arrival ? { arrivalAt: visit.arrival.at } : {}),
        ...(visit.departure ? { departureAt: visit.departure.at } : {}),
        detailsHidden: false,
      }

const scopedClients = async (context: ToolContext, clientId?: string): Promise<Client[]> => {
  if (principalOf(context).kind === "family" || clientId) return [await resolveClient(context, clientId)]
  return context.repo.listClients()
}

const spokenItem = (item: VisitListItem, perClient: boolean, timeZone: string): string => {
  const who = perClient ? "" : `${item.clientFirstName} `
  if (item.detailsHidden || !item.scheduledStart || !item.status) return `${who}(details hidden by the family)`.trim()
  return `${who}at ${spokenTime(item.scheduledStart, timeZone)}, ${statusLabel(item.status)}`
}

/** list_visits: visits on a date (default today), at most five in the voice answer. */
export async function listVisits(
  args: { date?: string; status?: Visit["status"]; clientId?: string },
  context: ToolContext,
): Promise<ListVisitsResult> {
  const clock = await clockOf(context)
  const date = args.date ?? clock.today
  const tz = clock.settings.timeZone
  const clients = await scopedClients(context, args.clientId)
  const byId = new Map(clients.map((client) => [client.id, client]))
  const visits = (await context.repo.listVisitsByDate(date, clients.length === 1 ? clients[0]?.id : undefined))
    .filter((visit) => byId.has(visit.clientId))
    .filter((visit) => !args.status || visit.status === args.status)
  const items = visits.map((visit) => {
    const client = byId.get(visit.clientId)!
    return itemFor(visit, client, detailsHidden(context, client), tz)
  })
  const when = date === clock.today ? "today" : `on ${formatLocalDate(date)}`
  const perClient = clients.length === 1
  const subject = perClient ? `${firstName(clients[0]!.name)} has` : "There are"
  const filter = args.status ? ` ${statusLabel(args.status)}` : ""
  const spoken =
    items.length === 0
      ? `${perClient ? `${firstName(clients[0]!.name)} has` : "There are"} no${filter} visits ${when}.`
      : `${subject} ${countPhrase(items.length, `${filter.trim() ? `${filter.trim()} ` : ""}visit`).toLowerCase()} ${when}: ${spokenList(items.map((item) => spokenItem(item, perClient, tz)))}.`
  return { spoken: spoken.replace(/\s+/g, " "), date, timeZone: tz, count: items.length, visits: items }
}
