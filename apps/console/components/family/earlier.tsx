"use client"

import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

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
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Separator } from "@workspace/ui/components/separator"

import type { EarlierAlert, FamilyDay } from "@/lib/views/family"

import { VisitItems } from "./day-card"

/** Earlier days and earlier alerts, collapsed so today stays calm. */
export function EarlierCard({
  days,
  alerts,
}: {
  days: FamilyDay[]
  alerts: EarlierAlert[]
}) {
  const [open, setOpen] = useState(false)
  if (days.length === 0 && alerts.length === 0) return null
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CardTitle>Earlier</CardTitle>
          <CardDescription>
            {days.length} earlier days this week
            {alerts.length > 0 ? `, ${alerts.length} earlier alerts the agency is following up` : ""}.
          </CardDescription>
          <CollapsibleTrigger render={<Button variant="outline" size="sm" className="w-fit" />}>
            {open ? "Hide Earlier" : "Show Earlier"}
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </CollapsibleTrigger>
        </CardHeader>
        <CollapsibleContent>
          <CardContent className="flex flex-col gap-4 pt-4">
            {alerts.length > 0 ? (
              <ItemGroup className="gap-2">
                {alerts.map((alert) => (
                  <Item key={alert.id} variant="muted">
                    <ItemContent>
                      <ItemTitle>
                        {alert.dateLabel}: {alert.kindLabel}
                      </ItemTitle>
                      <ItemDescription>
                        {alert.text} The agency has been notified.
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            ) : null}
            {alerts.length > 0 && days.length > 0 ? <Separator /> : null}
            {days.map((day) => (
              <section key={day.dayKey} className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">
                  {day.dateLabel}: {day.headline}
                </h3>
                <VisitItems visits={day.visits} />
              </section>
            ))}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
