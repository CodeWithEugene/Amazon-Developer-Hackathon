import { z } from "zod"

import {
  exceptionKindSchema,
  exceptionStateSchema,
  reconciliationOutcomeSchema,
  visitStatusSchema,
} from "@visitproof/domain"

/** Output schemas: every tool returns a `spoken` string plus structured data. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const dateArg = isoDate.optional().describe("Agency-local date as YYYY-MM-DD, default today")
export const clientIdArg = z.string().min(1).optional().describe("Client identifier; family accounts always use their own client")
export const confirmedArg = z
  .boolean()
  .optional()
  .describe("Set true only after the user explicitly said yes. Clients without elicitation must ask first and then call again with confirmed true.")

const visitItem = z.object({
  visitId: z.string(),
  status: visitStatusSchema,
  answer: z.enum(["arrived", "no_show", "not_yet_due", "awaiting_arrival", "unobservable", "needs_review"]),
  scheduledStart: z.string(),
  scheduledEnd: z.string(),
  window: z.string(),
  arrivalAt: z.string().optional(),
  departureAt: z.string().optional(),
  clockInAt: z.string().optional(),
  clockedInBy: z.string().optional(),
  reconciliation: reconciliationOutcomeSchema.optional(),
  observabilityReasons: z.array(z.string()),
  spoken: z.string(),
})

export const visitStatusOutput = {
  spoken: z.string(),
  answer: z.enum(["yes", "no", "not_yet", "unknown"]),
  clientId: z.string().optional(),
  date: z.string().optional(),
  timeZone: z.string().optional(),
  detailsHidden: z.boolean().optional(),
  visits: z.array(visitItem),
}

export const listVisitsOutput = {
  spoken: z.string(),
  date: z.string(),
  timeZone: z.string(),
  count: z.number().int().nonnegative(),
  visits: z.array(
    z.object({
      visitId: z.string(),
      clientId: z.string(),
      clientFirstName: z.string(),
      status: visitStatusSchema.optional(),
      scheduledStart: z.string().optional(),
      scheduledEnd: z.string().optional(),
      window: z.string().optional(),
      arrivalAt: z.string().optional(),
      departureAt: z.string().optional(),
      detailsHidden: z.boolean(),
    }),
  ),
}

export const exceptionsOutput = {
  spoken: z.string(),
  count: z.number().int().nonnegative(),
  from: z.string(),
  to: z.string(),
  timeZone: z.string(),
  state: z.enum(["open", "snoozed", "resolved", "any"]),
  exceptions: z.array(
    z.object({
      exceptionId: z.string(),
      visitId: z.string(),
      clientId: z.string(),
      clientFirstName: z.string().optional(),
      kind: exceptionKindSchema,
      state: exceptionStateSchema,
      openedAt: z.string(),
      scheduledStart: z.string().optional(),
      detailsHidden: z.boolean(),
    }),
  ),
}

const column = z.enum(["observed", "reported", "resolved"])

export const explainOutput = {
  spoken: z.string(),
  visitId: z.string().optional(),
  window: z.string().optional(),
  status: visitStatusSchema.optional(),
  summary: z.string().optional(),
  timeline: z
    .array(z.object({ column, at: z.string(), time: z.string(), text: z.string(), provenance: z.string().optional() }))
    .optional(),
  signedRecords: z
    .array(z.object({ seq: z.number(), column, subject: z.string(), signerKeyId: z.string(), signature: z.string() }))
    .optional(),
}

export const summaryOutput = {
  spoken: z.string(),
  clientId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  detailsHidden: z.boolean().optional(),
  counts: z
    .object({
      scheduled: z.number(),
      due: z.number(),
      onTime: z.number(),
      late: z.number(),
      noShow: z.number(),
      unobservable: z.number(),
      earlyDeparture: z.number(),
      corroborated: z.number(),
    })
    .optional(),
  lateVisits: z
    .array(z.object({ visitId: z.string(), scheduledStart: z.string(), arrivalAt: z.string(), minutesLate: z.number() }))
    .optional(),
}

export const writeOutput = {
  spoken: z.string(),
  status: z.enum(["done", "confirmation_required", "declined", "already_resolved"]),
  confirmationMethod: z.enum(["elicitation", "confirmed_argument"]).optional(),
  exceptionId: z.string().optional(),
  noteId: z.string().optional(),
  visitId: z.string().optional(),
  ledgerSeq: z.number().int().positive().optional(),
}

export { exceptionKindSchema, exceptionStateSchema, visitStatusSchema }
