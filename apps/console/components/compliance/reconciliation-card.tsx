"use client"

import Link from "next/link"
import { useState } from "react"
import { ListFilterIcon } from "lucide-react"

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
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { StatusBadge } from "@workspace/ui/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { ToggleGroup, ToggleGroupItem } from "@workspace/ui/components/toggle-group"

import { addDaysToKey } from "@/lib/time"
import type { ReconRow } from "@/lib/views/compliance"

import { PaginationBar, usePagination } from "../pagination-bar"

export type RangeKey = "today" | "week" | "two-weeks"
type OutcomeFilter =
  | "all"
  | "corroborated"
  | "contradicted"
  | "missing_clock_in"
  | "missing_both"
  | "unobservable"

const RANGE_DAYS: Record<RangeKey, number> = { today: 1, week: 7, "two-weeks": 14 }

const OUTCOME_TABS: readonly { value: OutcomeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "corroborated", label: "Corroborated" },
  { value: "contradicted", label: "Contradicted" },
  { value: "missing_clock_in", label: "Missing Clock-In" },
  { value: "missing_both", label: "Missing Both" },
  { value: "unobservable", label: "Unobservable" },
]

const PAGE_SIZE = 15

function matchesOutcome(row: ReconRow, filter: OutcomeFilter): boolean {
  if (filter === "all") return true
  if (filter === "corroborated") {
    return row.outcome === "corroborated" || row.outcome === "corroborated_with_variance"
  }
  return row.outcome === filter
}

export function inRange(row: ReconRow, range: RangeKey, today: string): boolean {
  const first = addDaysToKey(today, -(RANGE_DAYS[range] - 1))
  return row.dayKey >= first && row.dayKey <= today
}

export function ReconciliationCard({
  rows,
  today,
  range,
  onRange,
}: {
  rows: ReconRow[]
  today: string
  range: RangeKey
  onRange: (range: RangeKey) => void
}) {
  const [outcome, setOutcome] = useState<OutcomeFilter>("all")
  const ranged = rows.filter((row) => inRange(row, range, today))
  const count = (filter: OutcomeFilter) =>
    ranged.filter((row) => matchesOutcome(row, filter)).length
  const shown = ranged.filter((row) => matchesOutcome(row, outcome))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reconciliation</CardTitle>
        <CardDescription>
          Door observations joined with EVV clock-ins, newest first. Delta is
          the EVV time minus the door time, in minutes. Choose a range, then filter by
          outcome.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ToggleGroup
          aria-label="Date range"
          variant="outline"
          value={[range]}
          onValueChange={(value) => {
            const next = value[0] as RangeKey | undefined
            if (next) onRange(next)
          }}
        >
          <ToggleGroupItem value="today">Today</ToggleGroupItem>
          <ToggleGroupItem value="week">This Week</ToggleGroupItem>
          <ToggleGroupItem value="two-weeks">Two Weeks</ToggleGroupItem>
        </ToggleGroup>
        <Tabs value={outcome} onValueChange={(value) => setOutcome(value as OutcomeFilter)}>
          <TabsList className="h-auto flex-wrap justify-start group-data-horizontal/tabs:h-auto">
            {OUTCOME_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label} ({count(tab.value)})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <ReconciliationTable key={`${range}-${outcome}`} rows={shown} />
      </CardContent>
    </Card>
  )
}

function ReconciliationTable({ rows }: { rows: ReconRow[] }) {
  const pager = usePagination(rows, PAGE_SIZE)
  if (rows.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListFilterIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No Visits Match</EmptyTitle>
          <EmptyDescription>
            Nothing in this range has that outcome. Try This Week or Two Weeks.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Visit</TableHead>
            <TableHead>Date And Window</TableHead>
            <TableHead>Door Arrival</TableHead>
            <TableHead>Door Departure</TableHead>
            <TableHead>Clock-In</TableHead>
            <TableHead>Clock-Out</TableHead>
            <TableHead>Delta</TableHead>
            <TableHead>Outcome</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pager.slice.map((row) => (
            <ReconRowView key={row.visitId} row={row} />
          ))}
        </TableBody>
      </Table>
      <PaginationBar
        page={pager.page}
        pageCount={pager.pageCount}
        total={rows.length}
        label="Visits"
        onPage={pager.setPage}
      />
    </>
  )
}

function ReconRowView({ row }: { row: ReconRow }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <Link
            href={`/agency/visits/${encodeURIComponent(row.visitId)}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {row.clientName}
          </Link>
          <span className="text-xs text-muted-foreground">{row.caregiverName}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col">
          <span>{row.dateLabel}</span>
          <span className="text-xs text-muted-foreground">{row.window}</span>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">{row.doorArrival}</TableCell>
      <TableCell className="tabular-nums">{row.doorDeparture}</TableCell>
      <TableCell className="tabular-nums">{row.clockIn}</TableCell>
      <TableCell className="tabular-nums">{row.clockOut}</TableCell>
      <TableCell className="tabular-nums">
        <div className="flex flex-col">
          {row.deltaLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge status={row.outcome} />
      </TableCell>
    </TableRow>
  )
}
