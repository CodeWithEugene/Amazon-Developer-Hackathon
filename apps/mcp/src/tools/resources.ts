import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import { clockOf, detailsHidden, principalOf, resolveClient, ToolError, type ToolContext } from "./context"
import { spokenWindow } from "./format"
import { getVisitStatus } from "./visit-status"

const DATE = /^\d{4}-\d{2}-\d{2}$/

const single = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value)

/** JSON schedule for one client and date, scope-enforced like the tools. */
const readSchedule = async (context: ToolContext, uri: URL, clientId?: string, date?: string): Promise<ReadResourceResult> => {
  if (!clientId || !date || !DATE.test(date)) throw new ToolError("Use visitproof://schedule/{clientId}/{YYYY-MM-DD}.", "invalid")
  const client = await resolveClient(context, clientId)
  const { settings } = await clockOf(context)
  const hidden = detailsHidden(context, client)
  const visits = hidden ? [] : await context.repo.listVisitsByDate(date, client.id)
  const body = {
    clientId: client.id,
    date,
    timeZone: settings.timeZone,
    detailsHidden: hidden,
    visits: visits.map((visit) => ({
      visitId: visit.id,
      scheduledStart: visit.scheduledStart,
      scheduledEnd: visit.scheduledEnd,
      window: spokenWindow(visit.scheduledStart, visit.scheduledEnd, settings.timeZone),
      status: visit.status,
    })),
  }
  return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(body) }] }
}

const readFeed = async (context: ToolContext, uri: URL, clientId?: string): Promise<ReadResourceResult> => {
  if (!clientId) throw new ToolError("Use visitproof://feed/{clientId}/today.", "invalid")
  const status = await getVisitStatus({ clientId }, context)
  return { contents: [{ uri: uri.href, mimeType: "text/plain", text: status.spoken }] }
}

const visibleClients = async (context: ToolContext) => {
  const principal = principalOf(context)
  if (principal.kind === "family") return [await resolveClient(context, principal.clientId)]
  return context.repo.listClients()
}

export function registerResources(server: McpServer, context: ToolContext): void {
  server.registerResource(
    "schedule",
    new ResourceTemplate("visitproof://schedule/{clientId}/{date}", {
      list: async () => {
        const { today } = await clockOf(context)
        const clients = await visibleClients(context)
        return {
          resources: clients.map((client) => ({
            uri: `visitproof://schedule/${client.id}/${today}`,
            name: `Schedule for ${client.name.split(" ")[0]} today`,
            mimeType: "application/json",
          })),
        }
      },
    }),
    { title: "Visit Schedule", description: "Scheduled visits for one client on an agency-local date, as JSON.", mimeType: "application/json" },
    (uri, variables) => readSchedule(context, uri, single(variables.clientId), single(variables.date)),
  )

  server.registerResource(
    "feed",
    new ResourceTemplate("visitproof://feed/{clientId}/today", { list: undefined }),
    { title: "Today Feed", description: "Today's plain-language visit status for one client.", mimeType: "text/plain" },
    (uri, variables) => readFeed(context, uri, single(variables.clientId)),
  )
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "morning_briefing",
    {
      title: "Morning Briefing",
      description: "A short spoken briefing of today's visits and open exceptions.",
      argsSchema: { clientId: z.string().optional().describe("Client identifier; omit for the whole agency") },
    },
    ({ clientId }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Give me this morning's VisitProof briefing${clientId ? ` for client ${clientId}` : " for the agency"}.`,
              `Call get_visit_status${clientId ? ` with clientId ${clientId}` : " for each client"} and, for an agency account, list_exceptions for today.`,
              "Speak at most five items, use times exactly as the tools give them, and never name who the door saw.",
            ].join(" "),
          },
        },
      ],
    }),
  )
}
