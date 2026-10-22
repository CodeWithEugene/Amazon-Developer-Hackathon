"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Badge } from "@workspace/ui/components/badge"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemHeader,
  ItemTitle,
} from "@workspace/ui/components/item"
import { StatusBadge, statusLabel } from "@workspace/ui/components/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import type { RecordEntry, VisitRecordData } from "@/lib/views/visit-record"

const COLUMNS = [
  { value: "observed", label: "Observed", description: "What the doorbell saw. Only the Presence Engine writes this column." },
  { value: "reported", label: "Reported", description: "What the caregiver and family said: EVV clock-in and notes." },
  { value: "resolved", label: "Resolved", description: "What the agency decided, including corrections. It never overwrites the door." },
] as const

/** Observed, Reported, and Resolved as three separate tabs. */
export function VisitRecord({ data }: { data: VisitRecordData }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {data.clientName}, {data.dateLabel}
          </CardTitle>
          <CardDescription>
            {data.window}. Scheduled caregiver: {data.caregiverName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={data.status} />
            {statusLabel(data.outcome) === statusLabel(data.status) ? null : (
              <StatusBadge status={data.outcome} />
            )}
          </div>
          {data.narrative ? (
            <p className="text-sm text-muted-foreground">
              {data.narrative.text} ({data.narrative.provenance})
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {data.ledger.count} signed ledger records for this client.{" "}
            {data.ledger.verified ? "Chain and signatures verified." : "Chain verification failed."}
          </p>
        </CardContent>
      </Card>
      <Tabs defaultValue="observed">
        <TabsList>
          {COLUMNS.map((column) => (
            <TabsTrigger key={column.value} value={column.value}>
              {column.label} ({data[column.value].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {COLUMNS.map((column) => (
          <TabsContent key={column.value} value={column.value} className="flex flex-col gap-3 pt-2">
            <p className="text-sm text-muted-foreground">{column.description}</p>
            <EntryList entries={data[column.value]} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

function EntryList({ entries }: { entries: RecordEntry[] }) {
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing Recorded</EmptyTitle>
          <EmptyDescription>This column has no entries for the visit.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ItemGroup className="gap-2">
      {entries.map((entry) => (
        <Item key={entry.id} variant="outline">
          <ItemHeader>
            <ItemTitle>{entry.title}</ItemTitle>
            <Badge variant="outline">
              <span className="sr-only">Source: </span>
              {entry.source}
            </Badge>
          </ItemHeader>
          <ItemContent>
            <ItemDescription className="line-clamp-none">{entry.detail}</ItemDescription>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}
