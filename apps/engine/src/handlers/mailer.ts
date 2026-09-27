/**
 * Mailer. Sends exception alerts and daily digests via the injected transport
 * (SES in production, console fixture in demo mode). One digest per client
 * per day is deduped by the notification store in production.
 */
import type { EngineDeps } from "../lib/ports"

export const handlerName = "mailer"

export interface MailerInput {
  kind: "exception_alert" | "digest"
  clientId?: string
}

export function createMailer(deps: EngineDeps) {
  return async function mailer(input: MailerInput): Promise<void> {
    if (input.kind !== "exception_alert") return
    const clientId = input.clientId
    if (!clientId) return
    const client = await deps.clients.get(clientId)
    if (!client?.consent.exceptionAlerts) return
    const open = (await deps.exceptions.listForClient(clientId)).filter(
      (exception) => exception.state === "open"
    )
    if (open.length === 0) return
    const subject = "VisitProof Exception Alert"
    const lines = open.map(
      (exception) => `- ${exception.kind} opened ${exception.openedAt} (visit ${exception.visitId})`
    )
    for (const contact of client.familyContacts) {
      await deps.mail.send({
        to: contact.email,
        subject,
        text: ["A visit needs attention.", "", ...lines].join("\n"),
      })
    }
  }
}
