import { CircleCheckIcon, CircleHelpIcon, CircleXIcon, InfoIcon } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"

import { deviceCheckSummary, type CheckItem, type CheckState, type DeviceCheck } from "@/lib/ring/device-check"

const STATE: Readonly<
  Record<CheckState, { label: string; variant: "success" | "destructive" | "secondary" | "outline"; Icon: typeof CircleCheckIcon }>
> = {
  pass: { label: "Passing", variant: "success", Icon: CircleCheckIcon },
  fail: { label: "Needs Attention", variant: "destructive", Icon: CircleXIcon },
  unknown: { label: "Not Reported", variant: "secondary", Icon: CircleHelpIcon },
  info: { label: "Not Checked Here", variant: "outline", Icon: InfoIcon },
}

function CheckRow({ item }: { item: CheckItem }) {
  const state = STATE[item.state]
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <state.Icon aria-hidden="true" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {item.title}
          <Badge variant={state.variant}>{state.label}</Badge>
        </ItemTitle>
        <ItemDescription>{item.observed}</ItemDescription>
        {item.state === "pass" ? null : (
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Why it matters: </span>
              {item.whyItMatters}
            </p>
            <p>
              <span className="font-medium text-foreground">{item.required ? "Where to change it: " : "Where to check it: "}</span>
              {item.whereToChange}
            </p>
          </div>
        )}
      </ItemContent>
    </Item>
  )
}

export function DeviceCheckCard({ check }: { check: DeviceCheck }) {
  const informational = check.items.filter((item) => !item.required).length
  const summary = `${deviceCheckSummary(check)}${informational ? `, plus ${informational} informational ${informational === 1 ? "item" : "items"}` : ""}`
  return (
    <Card>
      <CardHeader>
        <CardTitle>{check.name}</CardTitle>
        <CardDescription>{check.location ? `${summary}. Location: ${check.location}.` : `${summary}.`}</CardDescription>
      </CardHeader>
      <CardContent>
        <ItemGroup className="gap-2">
          {check.items.map((item) => (
            <CheckRow key={item.id} item={item} />
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
