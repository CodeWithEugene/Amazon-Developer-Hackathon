/**
 * Mailer. Sends exception alerts and the daily digest via the injected
 * transport (SES in production, a console fixture in demo mode). Times are
 * rendered in the agency time zone (contract C1). Clients whose Ring link is
 * "removed" get no mail (contract C3).
 */
import type { Client, Exception, Visit } from "@visitproof/domain"

import { timeZoneFor } from "../lib/agency"
import type { EngineDeps } from "../lib/ports"
import { formatLocalTime, localDateKey } from "../lib/time"

export const handlerName = "mailer"

export interface MailerInput {
  kind: "exception_alert" | "digest"
  clientId?: string
  /** Digest date (YYYY-MM-DD in the agency zone); defaults to today there. */
  date?: string
}

const ALERT_SUBJECT = "VisitProof Exception Alert"
const DIGEST_SUBJECT = "VisitProof Daily Digest"

const humanKind = (kind: string): string => {
  const words = kind.replace(/_/g, " ")
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

const alertLine = (exception: Exception, timeZone: string): string =>
  `${humanKind(exception.kind)}, opened at ${formatLocalTime(exception.openedAt, timeZone)}.`

function digestLine(visit: Visit, timeZone: string): string {
  const scheduled = `Visit scheduled for ${formatLocalTime(visit.scheduledStart, timeZone)}.`
  const arrival = visit.arrival
    ? `Arrival seen at ${formatLocalTime(visit.arrival.at, timeZone)}.`
    : "No arrival seen."
  const departure = visit.departure
    ? `Departure seen at ${formatLocalTime(visit.departure.at, timeZone)}.`
    : ""
  const status = `Status: ${humanKind(visit.status)}.`
  return [scheduled, arrival, departure, status, visit.narrative?.text ?? ""]
    .filter(Boolean)
    .join(" ")
}

async function sendToFamily(
  deps: EngineDeps,
  client: Client,
  subject: string,
  text: string
) {
  for (const contact of client.familyContacts) {
    await deps.mail.send({ to: contact.email, subject, text })
  }
}

async function exceptionAlert(deps: EngineDeps, client: Client): Promise<void> {
  if (!client.consent.exceptionAlerts) return
  const open = (await deps.exceptions.listForClient(client.id)).filter(
    (exception) => exception.state === "open"
  )
  if (open.length === 0) return
  const timeZone = await timeZoneFor(deps, client.agencyId)
  const lines = open.map((exception) => `- ${alertLine(exception, timeZone)}`)
  await sendToFamily(
    deps,
    client,
    ALERT_SUBJECT,
    ["A visit needs attention.", "", ...lines].join("\n")
  )
}

async function digest(
  deps: EngineDeps,
  client: Client,
  date: string | undefined
): Promise<void> {
  const timeZone = await timeZoneFor(deps, client.agencyId)
  const day = date ?? localDateKey(deps.clock.now().toISOString(), timeZone)
  const visits = (await deps.visits.listForClient(client.id))
    .filter((visit) => localDateKey(visit.scheduledStart, timeZone) === day)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  if (visits.length === 0) return
  const lines = visits.map((visit) => `- ${digestLine(visit, timeZone)}`)
  await sendToFamily(
    deps,
    client,
    DIGEST_SUBJECT,
    [`Here is today's summary for ${client.homeLabel}.`, "", ...lines].join(
      "\n"
    )
  )
}

async function clientsFor(
  deps: EngineDeps,
  clientId: string | undefined
): Promise<Client[]> {
  if (clientId !== undefined) {
    const client = await deps.clients.get(clientId)
    return client === undefined ? [] : [client]
  }
  return (await deps.clients.list?.()) ?? []
}

export function createMailer(deps: EngineDeps) {
  return async function mailer(input: MailerInput): Promise<void> {
    if (input.kind === "exception_alert" && input.clientId === undefined) return
    for (const client of await clientsFor(deps, input.clientId)) {
      if (client.ringLinkStatus === "removed") continue
      if (input.kind === "exception_alert") await exceptionAlert(deps, client)
      else await digest(deps, client, input.date)
    }
  }
}
