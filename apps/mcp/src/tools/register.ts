import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { ToolError, type ToolContext } from "./context"
import { listExceptions } from "./exceptions"
import { explainVisit } from "./explain"
import {
  clientIdArg,
  confirmedArg,
  dateArg,
  exceptionKindSchema,
  exceptionsOutput,
  explainOutput,
  listVisitsOutput,
  summaryOutput,
  visitStatusOutput,
  visitStatusSchema,
  writeOutput,
} from "./schemas"
import { getClientSummary, SUMMARY_RANGES, type SummaryRange } from "./summary"
import { getVisitStatus } from "./visit-status"
import { listVisits } from "./visits"
import { acknowledgeException, addVisitNote } from "./writes"

/** Wraps a handler result as a text block plus matching structured content. */
export const withVoice = <T extends { spoken: string }>(result: T): CallToolResult => ({
  content: [{ type: "text", text: result.spoken }],
  structuredContent: { ...result } as Record<string, unknown>,
})

/** Scope and lookup refusals become `isError` results the assistant can read aloud. */
const run = async <T extends { spoken: string }>(work: () => Promise<T>): Promise<CallToolResult> => {
  try {
    return withVoice(await work())
  } catch (error) {
    if (error instanceof ToolError) {
      return { content: [{ type: "text", text: error.message }], isError: true }
    }
    throw error
  }
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const

const registerReadTools = (server: McpServer, context: ToolContext): void => {
  server.registerTool(
    "get_visit_status",
    {
      title: "Get Visit Status",
      description:
        "Did the caregiver come? Every visit for a client on a date (default today in the agency time zone): what the door observed, the caregiver's own clock-in, and what could not be observed.",
      inputSchema: { clientId: clientIdArg, date: dateArg },
      outputSchema: visitStatusOutput,
      annotations: { title: "Get Visit Status", ...READ },
    },
    (args) => run(() => getVisitStatus(args, context)),
  )

  server.registerTool(
    "list_visits",
    {
      title: "List Visits",
      description: "Visits on a date (default today), optionally one status or one client. The spoken answer names at most five.",
      inputSchema: { date: dateArg, status: visitStatusSchema.optional(), clientId: clientIdArg },
      outputSchema: listVisitsOutput,
      annotations: { title: "List Visits", ...READ },
    },
    (args) => run(() => listVisits(args, context)),
  )

  server.registerTool(
    "list_exceptions",
    {
      title: "List Exceptions",
      description:
        "Agency only. Exceptions for visits scheduled on a date (default today, open only), ranked by severity. Use kind late_arrival, state any, and days 7 for who was late this week.",
      inputSchema: {
        date: dateArg,
        state: z.enum(["open", "snoozed", "resolved", "any"]).optional().describe("Default open; any lists every state"),
        kind: exceptionKindSchema.optional(),
        days: z.number().int().min(1).max(31).optional().describe("Days to look back including the date, default 1"),
      },
      outputSchema: exceptionsOutput,
      annotations: { title: "List Exceptions", ...READ },
    },
    (args) => run(() => listExceptions(args, context)),
  )

  server.registerTool(
    "explain_visit",
    {
      title: "Explain Visit",
      description: "Explains one visit in plain language with its evidence timeline across the Observed, Reported, and Resolved columns and its signed ledger records.",
      inputSchema: { visitId: z.string().min(1).describe("Visit identifier") },
      outputSchema: explainOutput,
      annotations: { title: "Explain Visit", ...READ },
    },
    (args) => run(() => explainVisit(args, context)),
  )

  server.registerTool(
    "get_client_summary",
    {
      title: "Get Client Summary",
      description: "Door reliability for one client over the last week, two weeks, or month: on time, late, no-shows, and visits that could not be observed.",
      inputSchema: {
        clientId: clientIdArg,
        range: z.enum(Object.keys(SUMMARY_RANGES) as [SummaryRange, ...SummaryRange[]]).optional().describe("Default week"),
      },
      outputSchema: summaryOutput,
      annotations: { title: "Get Client Summary", ...READ },
    },
    (args) => run(() => getClientSummary(args, context)),
  )
}

const registerWriteTools = (server: McpServer, context: ToolContext): void => {
  server.registerTool(
    "acknowledge_exception",
    {
      title: "Acknowledge Exception",
      description:
        "Agency only. Acknowledges and resolves an open exception with a reason, signed into the Resolved column. Requires confirmation: elicitation when supported, otherwise ask the user and call again with confirmed true.",
      inputSchema: {
        exceptionId: z.string().min(1),
        reason: z.string().min(2).max(200).describe("Reason code or short reason, for example traffic_delay"),
        confirmed: confirmedArg,
      },
      outputSchema: writeOutput,
      // Destructive: it changes an existing exception's state (not additive).
      annotations: { title: "Acknowledge Exception", ...WRITE, destructiveHint: true },
    },
    (args) => run(() => acknowledgeException(args, context)),
  )

  server.registerTool(
    "add_visit_note",
    {
      title: "Add Visit Note",
      description:
        "Adds a note to a visit, signed into the Reported column. Family accounts can note only their own visits. Requires confirmation: elicitation when supported, otherwise ask and call again with confirmed true.",
      inputSchema: {
        visitId: z.string().min(1),
        text: z.string().trim().min(1).max(2000),
        confirmed: confirmedArg,
      },
      outputSchema: writeOutput,
      annotations: { title: "Add Visit Note", ...WRITE },
    },
    (args) => run(() => addVisitNote(args, context)),
  )
}

/** Registers the seven tools of docs/build.md Section 8.1. */
export function registerTools(server: McpServer, context: ToolContext): void {
  registerReadTools(server, context)
  registerWriteTools(server, context)
}
