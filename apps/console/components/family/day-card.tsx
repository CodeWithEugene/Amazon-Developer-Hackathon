"use client"


import Link from "next/link"
import { CalendarHeartIcon } from "lucide-react"

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
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { StatusBadge } from "@workspace/ui/components/status-badge"

import type { FamilyDay, FamilyVisit } from "@/lib/views/family"

/** One calm card for today: a headline, then every visit of the day. */
export function TodayCard({ day }: { day: FamilyDay }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>Today, {day.dateLabel}</CardDescription>
        <CardTitle className="text-2xl">{day.headline} today</CardTitle>
      </CardHeader>
      <CardContent>
        {day.visits.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarHeartIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nothing Today</EmptyTitle>
              <EmptyDescription>
                When a visit is scheduled, one calm message will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <VisitItems visits={day.visits} />
        )}
      </CardContent>
    </Card>
  )
}

export function VisitItems({ visits }: { visits: FamilyVisit[] }) {
  return (
    <ItemGroup className="gap-2">
      {visits.map((visit) => (
        <Item
          key={visit.id}
          variant="outline"
          render={<Link href={`/family/visits/${encodeURIComponent(visit.id)}`} />}
        >
          <ItemContent className="min-w-0 basis-full sm:basis-0">
            <ItemTitle className="line-clamp-none">{visit.window}</ItemTitle>
            {visit.narrative ? (
              <ItemDescription className="line-clamp-none">
                {visit.narrative.text}{" "}
                <span className="text-xs">({visit.narrative.provenance})</span>
              </ItemDescription>
            ) : (
              <ItemDescription className="line-clamp-none">{visit.line}</ItemDescription>
            )}
          </ItemContent>
          <StatusBadge status={visit.status} />
        </Item>
      ))}
    </ItemGroup>
  )
}
