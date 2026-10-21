/**
 * Amazon SES mail transport for the daily digest and exception alerts.
 *
 * Sandbox safe: every message is sent from the one verified sender
 * (SES_FROM_ADDRESS); nothing else is ever used as Source. New SES accounts
 * start in the sandbox, where recipients must be verified too, so an optional
 * recipient allowlist (SES_ALLOWED_RECIPIENTS) skips any other address
 * instead of letting SES reject the call.
 */
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses"
import { z } from "zod"

import { consoleLogger, type Logger, type MailTransport } from "../lib/ports"

const CHARSET = "UTF-8"
const emailSchema = z.email()

export interface SesMailerOptions {
  client: Pick<SESClient, "send">
  /** The SES verified identity used as Source for every message. */
  fromAddress: string
  /** When set, only these (verified) recipients are mailed. */
  allowedRecipients?: readonly string[]
  logger?: Logger
}

export function createSesMailTransport(
  options: SesMailerOptions
): MailTransport {
  const from = emailSchema.parse(options.fromAddress)
  const allowed =
    options.allowedRecipients === undefined
      ? undefined
      : new Set(
          options.allowedRecipients.map((address) => address.toLowerCase())
        )
  const logger = options.logger ?? consoleLogger
  return {
    async send(input) {
      const to = emailSchema.parse(input.to)
      if (allowed !== undefined && !allowed.has(to.toLowerCase())) {
        logger.warn(
          "[ses-mailer] recipient not in the SES sandbox allowlist; not sent",
          {
            subject: input.subject,
          }
        )
        return
      }
      await options.client.send(
        new SendEmailCommand({
          Source: from,
          Destination: { ToAddresses: [to] },
          Message: {
            Subject: { Data: input.subject, Charset: CHARSET },
            Body: { Text: { Data: input.text, Charset: CHARSET } },
          },
        })
      )
    },
  }
}
