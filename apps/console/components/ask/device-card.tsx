import { CheckIcon, MessageSquareTextIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@workspace/ui/components/item"
import { StatusBadge } from "@workspace/ui/components/status-badge"
import { cn } from "@workspace/ui/lib/utils"

import { observedStatus } from "@/lib/views/family-summary"

import { TOOL_TITLES, type DeviceSize, type ToolCall } from "./ask-types"

/**
 * The Echo Show preview: the tool's structured content rendered as a Card
 * (the MCP Toolkit "Card" and "List" patterns). At most five rows, like the
 * spoken answer; the rest stay in Response Detail.
 */
const MAX_ROWS = 5

type Row = { key: string; title: string; description?: string; status?: string }

const asArray = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : []

const text = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined)

const localTime = (iso: unknown, timeZone: string): string | undefined => {
  const value = text(iso)
  if (!value) return undefined
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value))
  const zone = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortGeneric" }).formatToParts(new Date(value)).find((part) => part.type === "timeZoneName")?.value
  return zone ? `${time} ${zone}` : time
}

/** Shows the same status the family and visit pages show for this visit. */
const visitStatus = (visit: Record<string, unknown>): string | undefined => {
  const status = text(visit.status)
  const scheduledEnd = text(visit.scheduledEnd)
  if (!status || !scheduledEnd) return status
  return observedStatus(
    { status, arrived: Boolean(text(visit.arrivalAt)), departed: Boolean(text(visit.departureAt)), scheduledEnd },
    new Date()
  )
}

const ROW_BUILDERS: Record<string, (content: Record<string, unknown>) => Row[]> = {
  get_visit_status: (content) =>
    asArray(content.visits).map((visit) => ({ key: String(visit.visitId), title: text(visit.window) ?? "Visit", description: text(visit.spoken), status: visitStatus(visit) })),
  list_visits: (content) =>
    asArray(content.visits).map((visit) => ({
      key: String(visit.visitId),
      title: `${text(visit.clientFirstName) ?? "Client"}${text(visit.window) ? `, ${text(visit.window)}` : ""}`,
      description: visit.detailsHidden ? "Details hidden by the family." : undefined,
      status: text(visit.status),
    })),
  list_exceptions: (content) => {
    const timeZone = text(content.timeZone) ?? "America/New_York"
    return asArray(content.exceptions).map((item) => ({
      key: String(item.exceptionId),
      title: `${text(item.clientFirstName) ?? "Client"}${localTime(item.scheduledStart, timeZone) ? ` at ${localTime(item.scheduledStart, timeZone)}` : ""}`,
      status: text(item.kind),
    }))
  },
  explain_visit: (content) =>
    asArray(content.timeline).map((entry, index) => ({
      key: `${index}`,
      title: `${text(entry.time) ?? ""} ${String(entry.column ?? "").replace(/^./, (c) => c.toUpperCase())}`.trim(),
      description: text(entry.text),
    })),
}

const summaryRows = (content: Record<string, unknown>): Row[] => {
  const counts = (content.counts ?? {}) as Record<string, number>
  const labels: Array<[string, string, string]> = [
    ["onTime", "Arrived On Time", "on_time"],
    ["late", "Arrived Late", "late"],
    ["noShow", "No One At The Door", "no_show"],
    ["unobservable", "Could Not Be Observed", "unobservable"],
  ]
  return labels.map(([key, title, status]) => ({ key, title: `${counts[key] ?? 0} ${title}`, status }))
}

const rowsFor = (call: ToolCall): Row[] => {
  const content = call.structuredContent ?? {}
  if (call.name === "get_client_summary") return summaryRows(content)
  return (ROW_BUILDERS[call.name]?.(content) ?? []).slice(0, MAX_ROWS)
}

export function DeviceCard({ call, spoken, size }: { call?: ToolCall; spoken: string; size: DeviceSize }) {
  const rows = call ? rowsFor(call) : []
  const status = text(call?.structuredContent?.status)
  return (
    <Card size={size === "small" ? "sm" : "default"} className={cn("h-full w-full", size === "small" ? "text-xs" : "")}>
      <CardHeader>
        <CardTitle>{call ? (TOOL_TITLES[call.name] ?? "VisitProof") : "VisitProof"}</CardTitle>
        <CardDescription>{spoken}</CardDescription>
      </CardHeader>
      {rows.length > 0 ? (
        <CardContent>
          <ItemGroup>
            {rows.map((row) => (
              <Item key={row.key} size="sm" variant="outline">
                <ItemContent>
                  <ItemTitle>{row.title}</ItemTitle>
                  {row.description && size === "large" ? <ItemDescription>{row.description}</ItemDescription> : null}
                </ItemContent>
                {row.status ? <StatusBadge status={row.status} /> : null}
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      ) : null}
      {status ? (
        <CardFooter>
          <Badge variant={status === "done" ? "default" : "secondary"}>
            {status === "done" ? <CheckIcon data-icon="inline-start" aria-hidden="true" /> : <MessageSquareTextIcon data-icon="inline-start" aria-hidden="true" />}
            {status === "done" ? "Signed And Saved" : status === "confirmation_required" ? "Waiting For Your Yes" : "Nothing Changed"}
          </Badge>
        </CardFooter>
      ) : null}
    </Card>
  )
}
