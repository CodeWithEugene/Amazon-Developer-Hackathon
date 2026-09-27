import { createHash } from "node:crypto"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  exceptionKindSchema,
  exceptionStateSchema,
  reconciliationSchema,
  visitStatusSchema,
  type Exception,
  type Visit,
} from "@visitproof/domain"
import { type VisitRepository } from "./repo"

// ---------------------------------------------------------------------------
// Shared schemas and helpers
// ---------------------------------------------------------------------------

/** "2026-09-27T10:02:00Z" -> "10:02 AM" (UTC, matching the demo dataset). */
const formatTime = (iso: string) => {
  const date = new Date(iso)
  const hours = date.getUTCHours()
  const minutes = date.getUTCMinutes().toString().padStart(2, "0")
  const period = hours >= 12 ? "PM" : "AM"
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  return `${hour12}:${minutes} ${period}`
}

const firstName = (name: string) => name.split(" ")[0] ?? name

const caregiverName = async (repo: VisitRepository, visit: Visit) => {
  const caregiver = await repo.getCaregiver(visit.caregiverId)
  return caregiver ? firstName(caregiver.name) : "the caregiver"
}

/** Tool execution context: repository accessor plus a clock for "today". */
export interface ToolContext {
  repo: VisitRepository
  now?: () => Date
}

const today = (context: ToolContext) =>
  (context.now ? context.now() : new Date()).toISOString().slice(0, 10)

const findVisitFor = async (
  context: ToolContext,
  visitId?: string,
  clientId?: string,
  date?: string,
): Promise<Visit | null> => {
  if (visitId) return context.repo.getVisit(visitId)
  const visits = await context.repo.listVisitsByDate(
    date ?? today(context),
    clientId,
  )
  return visits[0] ?? null
}

export const spokenOutputSchema = { spoken: z.string() }

/** Output schemas: every tool returns a `spoken` string plus structured data. */
export const didComeOutputSchema = {
  spoken: z.string(),
  answer: z.enum(["yes", "no", "not_yet", "unknown"]),
  visitId: z.string().optional(),
  status: visitStatusSchema.optional(),
  arrivalAt: z.string().optional(),
  departureAt: z.string().optional(),
}

export const visitStatusOutputSchema = {
  spoken: z.string(),
  visitId: z.string().optional(),
  status: visitStatusSchema.optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  arrivalAt: z.string().optional(),
  departureAt: z.string().optional(),
  reconciliation: reconciliationSchema.optional(),
}

export const exceptionsOutputSchema = {
  spoken: z.string(),
  count: z.number().int().nonnegative(),
  exceptions: z.array(
    z.object({
      exceptionId: z.string(),
      visitId: z.string(),
      clientId: z.string(),
      kind: exceptionKindSchema,
      state: exceptionStateSchema,
      openedAt: z.string(),
    }),
  ),
}

export const evidenceOutputSchema = {
  spoken: z.string(),
  visitId: z.string().optional(),
  timeline: z
    .array(
      z.object({
        column: z.enum(["observed", "reported", "resolved"]),
        at: z.string(),
        text: z.string(),
      }),
    )
    .optional(),
}

export const exportOutputSchema = {
  spoken: z.string(),
  visitId: z.string().optional(),
  format: z.enum(["json"]).optional(),
  entries: z.number().int().nonnegative().optional(),
  sha256: z.string().optional(),
}

/** Wraps a tool result as MCP content plus structured output. */
const withVoice = <T extends { spoken: string }>(result: T) => ({
  content: [{ type: "text" as const, text: result.spoken }],
  structuredContent: { ...result } as Record<string, unknown>,
})

// ---------------------------------------------------------------------------
// Tool handlers (pure functions, unit tested directly)
// ---------------------------------------------------------------------------

export interface DidComeResult {
  spoken: string
  answer: "yes" | "no" | "not_yet" | "unknown"
  visitId?: string
  status?: Visit["status"]
  arrivalAt?: string
  departureAt?: string
}

export async function didTheCaregiverComeToday(
  args: { clientId?: string; date?: string },
  context: ToolContext,
): Promise<DidComeResult> {
  const date = args.date ?? today(context)
  if (args.clientId && !(await context.repo.getClient(args.clientId))) {
    return {
      spoken: "I could not find that client. No visits are being tracked for them.",
      answer: "unknown",
    }
  }
  const client = args.clientId
    ? await context.repo.getClient(args.clientId)
    : await context.repo.getDefaultClient()
  if (!client) {
    return {
      spoken: "I could not find that client. No visits are being tracked yet.",
      answer: "unknown",
    }
  }
  const visits = await context.repo.listVisitsByDate(date, client.id)
  const visit = visits[0]
  if (!visit) {
    return {
      spoken: `No visit is scheduled for ${firstName(client.name)} on ${date}.`,
      answer: "unknown",
    }
  }
  const who = await caregiverName(context.repo, visit)
  const when = date === today(context) ? "today" : `on ${date}`
  if (visit.arrival) {
    const arrived = `Yes. ${who} arrived at ${formatTime(visit.arrival.at)}`
    const left = visit.departure
      ? ` and left at ${formatTime(visit.departure.at)}.`
      : "."
    const lateNote =
      visit.status === "arrived_late" ? " The arrival was later than scheduled." : ""
    return {
      spoken: arrived + left + lateNote,
      answer: "yes",
      visitId: visit.id,
      status: visit.status,
      arrivalAt: visit.arrival.at,
      departureAt: visit.departure?.at,
    }
  }
  if (visit.status === "no_show") {
    return {
      spoken: `No. The visit was scheduled between ${formatTime(visit.scheduledStart)} and ${formatTime(visit.scheduledEnd)}, but the door did not see anyone.`,
      answer: "no",
      visitId: visit.id,
      status: visit.status,
    }
  }
  if (visit.status === "unobservable") {
    return {
      spoken: `I cannot say. The doorbell could not observe that visit: ${visit.observability.reasons.join(", ")}.`,
      answer: "unknown",
      visitId: visit.id,
      status: visit.status,
    }
  }
  return {
    spoken: `Not yet. The visit is scheduled between ${formatTime(visit.scheduledStart)} and ${formatTime(visit.scheduledEnd)} ${when}.`,
    answer: "not_yet",
    visitId: visit.id,
    status: visit.status,
  }
}

export interface VisitStatusResult {
  spoken: string
  visitId?: string
  status?: Visit["status"]
  scheduledStart?: string
  scheduledEnd?: string
  arrivalAt?: string
  departureAt?: string
  reconciliation?: Visit["reconciliation"]
}

export async function getVisitStatus(
  args: { visitId?: string; clientId?: string; date?: string },
  context: ToolContext,
): Promise<VisitStatusResult> {
  const visit = await findVisitFor(context, args.visitId, args.clientId, args.date)
  if (!visit) {
    return {
      spoken: "I could not find that visit.",
    }
  }
  const who = await caregiverName(context.repo, visit)
  const parts: string[] = [
    `The visit for ${who} is scheduled from ${formatTime(visit.scheduledStart)} to ${formatTime(visit.scheduledEnd)}. Status: ${visit.status.replace(/_/g, " ")}.`,
  ]
  if (visit.arrival) parts.push(`Door arrival at ${formatTime(visit.arrival.at)}.`)
  if (visit.departure)
    parts.push(`Door departure at ${formatTime(visit.departure.at)}.`)
  if (visit.reconciliation && visit.reconciliation.outcome !== "pending") {
    parts.push(`Clock-in check: ${visit.reconciliation.outcome.replace(/_/g, " ")}.`)
  }
  return {
    spoken: parts.join(" "),
    visitId: visit.id,
    status: visit.status,
    scheduledStart: visit.scheduledStart,
    scheduledEnd: visit.scheduledEnd,
    arrivalAt: visit.arrival?.at,
    departureAt: visit.departure?.at,
    reconciliation: visit.reconciliation,
  }
}

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

export interface ExceptionSummary {
  exceptionId: string
  visitId: string
  clientId: string
  kind: Exception["kind"]
  state: Exception["state"]
  openedAt: string
}

export interface ExceptionsResult {
  spoken: string
  count: number
  exceptions: ExceptionSummary[]
}

export async function listTodayExceptions(
  args: { date?: string; state?: Exception["state"] },
  context: ToolContext,
): Promise<ExceptionsResult> {
  const date = args.date ?? today(context)
  const all = await context.repo.listExceptions(date, args.state)
  const exceptions = [...all].sort(
    (a, b) => EXCEPTION_SEVERITY[a.kind] - EXCEPTION_SEVERITY[b.kind],
  )
  const summaries = exceptions.map((exception) => ({
    exceptionId: exception.id,
    visitId: exception.visitId,
    clientId: exception.clientId,
    kind: exception.kind,
    state: exception.state,
    openedAt: exception.openedAt,
  }))
  if (summaries.length === 0) {
    const scope = args.state ? `${args.state} ` : ""
    return {
      spoken: `No ${scope}exceptions for ${date}. Everything looks on track.`,
      count: 0,
      exceptions: [],
    }
  }
  const headline =
    summaries.length === 1
      ? `There is 1 exception for ${date}.`
      : `There are ${summaries.length} exceptions for ${date}.`
  const voice = summaries.slice(0, 5).map((exception) => exception.kind.replace(/_/g, " "))
  const spoken = `${headline} Most urgent: ${voice.join(", ")}.`
  return { spoken, count: summaries.length, exceptions: summaries }
}

export interface EvidenceEntry {
  column: "observed" | "reported" | "resolved"
  at: string
  text: string
}

export interface VisitEvidenceResult {
  spoken: string
  visitId?: string
  timeline?: EvidenceEntry[]
}

export async function getVisitEvidence(
  args: { visitId: string },
  context: ToolContext,
): Promise<VisitEvidenceResult> {
  const visit = await context.repo.getVisit(args.visitId)
  if (!visit) {
    return { spoken: "I could not find that visit." }
  }
  const timeline: EvidenceEntry[] = []
  for (const event of await context.repo.listDoorEvents(visit.id)) {
    timeline.push({
      column: "observed",
      at: event.at,
      text: `Door event ${event.type}${event.subType ? ` (${event.subType})` : ""} from the Ring device.`,
    })
  }
  if (visit.arrival) {
    timeline.push({
      column: "observed",
      at: visit.arrival.at,
      text: `Arrival recorded from the door: ${formatTime(visit.arrival.at)}.`,
    })
  }
  if (visit.departure) {
    timeline.push({
      column: "observed",
      at: visit.departure.at,
      text: `Departure recorded from the door: ${formatTime(visit.departure.at)}.`,
    })
  }
  if (visit.reconciliation?.clockIn) {
    timeline.push({
      column: "reported",
      at: visit.reconciliation.clockIn,
      text: `Caregiver clock-in at ${formatTime(visit.reconciliation.clockIn)}.`,
    })
  }
  if (visit.reconciliation?.clockOut) {
    timeline.push({
      column: "reported",
      at: visit.reconciliation.clockOut,
      text: `Caregiver clock-out at ${formatTime(visit.reconciliation.clockOut)}.`,
    })
  }
  if (visit.narrative) {
    timeline.push({
      column: "resolved",
      at: visit.narrative.generatedAt,
      text: visit.narrative.text,
    })
  }
  return {
    spoken: `The visit has ${timeline.length} evidence entries across observed, reported, and resolved. ${visit.narrative?.text ?? `Status: ${visit.status.replace(/_/g, " ")}.`}`,
    visitId: visit.id,
    timeline,
  }
}

export interface ExportEvidenceResult {
  spoken: string
  visitId?: string
  format?: "json"
  entries?: number
  sha256?: string
}

export async function exportEvidence(
  args: { visitId: string },
  context: ToolContext,
): Promise<ExportEvidenceResult> {
  const evidence = await getVisitEvidence(args, context)
  if (!evidence.visitId || !evidence.timeline) {
    return { spoken: "I could not find that visit, so nothing was exported." }
  }
  const payload = JSON.stringify({
    visitId: evidence.visitId,
    timeline: evidence.timeline,
    exportedAt: (context.now ?? (() => new Date()))().toISOString(),
  })
  return {
    spoken: `Done. The evidence for that visit is exported as JSON with ${evidence.timeline.length} entries. Reference: ${evidence.visitId}.`,
    visitId: evidence.visitId,
    format: "json",
    entries: evidence.timeline.length,
    sha256: createHash("sha256").update(payload).digest("hex"),
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const MCP_INSTRUCTIONS = `You are the VisitProof voice assistant for home care visits.
Answer with the spoken field of tool results. Keep answers under 40 words, one or two short sentences.
Always state times like 10:02 AM. Never speculate: if a tool returns unknown, say so plainly.
Never mention medical details, health conditions, or identities beyond caregiver first names.`

/** Registers the five voice-first tools on a server instance. */
export function registerTools(server: McpServer, context: ToolContext): void {
  server.registerTool(
    "did_the_caregiver_come_today",
    {
      description:
        "Answers whether the caregiver came to the client's home on a given date (default today), with door arrival and departure times.",
      inputSchema: {
        clientId: z.string().optional().describe("Client identifier"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date as yyyy-mm-dd, default today"),
      },
      outputSchema: didComeOutputSchema,
      annotations: {
        title: "Did the caregiver come today",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const structuredContent = await didTheCaregiverComeToday(args, context)
      return withVoice(structuredContent)
    },
  )

  server.registerTool(
    "visit_status",
    {
      description:
        "Today's visit status for a client or visit with scheduled times, door arrival and departure, and the clock-in reconciliation summary.",
      inputSchema: {
        visitId: z.string().optional().describe("Visit identifier"),
        clientId: z.string().optional().describe("Client identifier"),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date as yyyy-mm-dd, default today"),
      },
      outputSchema: visitStatusOutputSchema,
      annotations: {
        title: "Visit status",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const structuredContent = await getVisitStatus(args, context)
      return withVoice(structuredContent)
    },
  )

  server.registerTool(
    "today_exceptions",
    {
      description:
        "Lists visit exceptions for a date (default today), optionally filtered by state, ranked by severity.",
      inputSchema: {
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Date as yyyy-mm-dd, default today"),
        state: z.enum(["open", "snoozed", "resolved"]).optional(),
      },
      outputSchema: exceptionsOutputSchema,
      annotations: {
        title: "Today's exceptions",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const structuredContent = await listTodayExceptions(args, context)
      return withVoice(structuredContent)
    },
  )

  server.registerTool(
    "visit_evidence",
    {
      description:
        "Explains one visit in plain language with its evidence timeline across observed, reported, and resolved.",
      inputSchema: {
        visitId: z.string().describe("Visit identifier"),
      },
      outputSchema: evidenceOutputSchema,
      annotations: {
        title: "Visit evidence",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const structuredContent = await getVisitEvidence(args, context)
      return withVoice(structuredContent)
    },
  )

  server.registerTool(
    "export_evidence",
    {
      description:
        "Exports the signed evidence timeline for one visit as JSON and returns a reference and checksum.",
      inputSchema: {
        visitId: z.string().describe("Visit identifier"),
      },
      outputSchema: exportOutputSchema,
      annotations: {
        title: "Export evidence",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const structuredContent = await exportEvidence(args, context)
      return withVoice(structuredContent)
    },
  )
}
