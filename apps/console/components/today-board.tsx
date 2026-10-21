"use client"

import Link from "next/link"
import { useState } from "react"
import {
  CalendarXIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  DatabaseIcon,
} from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { StatusBadge } from "@workspace/ui/components/status-badge"

import {
  EXCEPTION_GROUP_TITLES,
  type ExceptionGroup,
} from "@/lib/views/grouping"
import type { BoardExceptionRow, TodayBoardData } from "@/lib/views/today"

import { ExceptionCard } from "./today/exception-card"

const GROUP_ORDER: readonly ExceptionGroup[] = ["today", "week", "older", "snoozed"]

export function TodayBoard({
  data,
  timeZoneLabel,
}: {
  data: TodayBoardData
  timeZoneLabel: string
}) {
  if (data.storeEmpty) return <NoDemoData />
  const { stats } = data
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Visits Today" value={stats.visitsToday} />
        <StatCard title="In Progress" value={stats.inProgress} />
        <StatCard title="Exceptions Open" value={stats.openExceptions} />
        <StatCard
          title="Unlinked Clients"
          value={stats.unlinkedClients}
          description="Ring not linked, paused, or removed"
        />
      </div>
      <ExceptionsCard rows={data.exceptions} timeZoneLabel={timeZoneLabel} />
      <VisitsTodayCard data={data} />
    </div>
  )
}

function ExceptionsCard({
  rows,
  timeZoneLabel,
}: {
  rows: BoardExceptionRow[]
  timeZoneLabel: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exception Cards</CardTitle>
        <CardDescription>
          Late arrivals, no shows, early departures, and unobservable visits
          that need a decision. Times are in {timeZoneLabel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleCheckIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>All Clear</EmptyTitle>
              <EmptyDescription>
                No open exceptions. New ones appear here as the doorbell reports.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          GROUP_ORDER.map((group) => (
            <ExceptionGroupSection
              key={group}
              group={group}
              rows={rows.filter((r) => r.group === group)}
              timeZoneLabel={timeZoneLabel}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}

function ExceptionGroupSection({
  group,
  rows,
  timeZoneLabel,
}: {
  group: ExceptionGroup
  rows: BoardExceptionRow[]
  timeZoneLabel: string
}) {
  const [open, setOpen] = useState(group === "today")
  if (rows.length === 0 && group !== "today") return null
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger
        render={<Button variant="ghost" className="w-full justify-between" />}
      >
        <span>
          {EXCEPTION_GROUP_TITLES[group]} ({rows.length})
        </span>
        <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {rows.length === 0 ? (
          <p className="px-3 text-sm text-muted-foreground">
            Nothing needs a decision for today&apos;s visits.
          </p>
        ) : (
          <ItemGroup className="gap-2">
            {rows.map((row) => (
              <ExceptionCard key={row.id} row={row} timeZoneLabel={timeZoneLabel} />
            ))}
          </ItemGroup>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function VisitsTodayCard({ data }: { data: TodayBoardData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Visits Today</CardTitle>
        <CardDescription>
          {data.todayLabel}. Live visit status from the doorbell, per client.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.visits.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarXIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No Visits Today</EmptyTitle>
              <EmptyDescription>
                Earlier visits are on the Compliance page and in each exception card.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {data.visits.map((visit) => (
              <VisitTodayItem key={visit.id} visit={visit} />
            ))}
          </ItemGroup>
        )}
      </CardContent>
    </Card>
  )
}

function VisitTodayItem({ visit }: { visit: TodayBoardData["visits"][number] }) {
  return (
    <Item
      variant="outline"
      render={<Link href={`/agency/visits/${encodeURIComponent(visit.id)}`} />}
    >
      <ItemContent>
        <ItemTitle>
          {visit.clientName} with {visit.caregiverName}
        </ItemTitle>
        <ItemDescription>
          {visit.hidden
            ? `${visit.window}. The family paused sharing, so door times are hidden.`
            : `${visit.window}. Arrival ${visit.arrival}. Departure ${visit.departure}.`}
        </ItemDescription>
      </ItemContent>
      <StatusBadge status={visit.hidden ? "paused" : visit.status} />
    </Item>
  )
}

function StatCard({
  title,
  value,
  description,
}: {
  title: string
  value: number
  description?: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {description ? (
        <CardContent>
          <p className="text-xs text-muted-foreground">{description}</p>
        </CardContent>
      ) : null}
    </Card>
  )
}

export function NoDemoData() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>No Demo Data Yet</EmptyTitle>
        <EmptyDescription>
          The demo store is empty. Run <code>pnpm demo</code> from the repo root
          to replay two weeks of visits, then refresh this page.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
