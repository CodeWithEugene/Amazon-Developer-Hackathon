import { CircleAlertIcon, ClockIcon, EyeOffIcon, TrashIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"

import type { FamilyData } from "@/lib/views/family"

import { HonestBoundaries } from "./honest-boundaries"
import { ConsentCard } from "./family/consent-card"
import { DataCard } from "./family/data-card"
import { TodayCard } from "./family/day-card"
import { EarlierCard } from "./family/earlier"
import { FamilyLinks } from "./family/links"

export function FamilyView({ data }: { data: FamilyData }) {
  return (
    <div className="flex flex-col gap-6">
      <StateAlert data={data} />
      {data.erased ? null : (
        <>
          <TodayCard day={data.today} />
          <EarlierCard days={data.earlierDays} alerts={data.earlierAlerts} />
        </>
      )}
      <HonestBoundaries />
      <FamilyLinks />
      <ConsentCard data={data} />
      <DataCard erased={data.erased} />
    </div>
  )
}

function StateAlert({ data }: { data: FamilyData }) {
  if (data.erased) {
    return (
      <Alert>
        <TrashIcon aria-hidden="true" />
        <AlertTitle>Your Data Was Deleted</AlertTitle>
        <AlertDescription>
          The door record, snapshots, and notes for this home were deleted and
          the doorbell link was removed. The agency sees only its own schedule.
        </AlertDescription>
      </Alert>
    )
  }
  if (!data.client.consent.shareWithAgency) {
    return (
      <Alert>
        <EyeOffIcon aria-hidden="true" />
        <AlertTitle>Sharing Is Paused</AlertTitle>
        <AlertDescription>
          The agency cannot see visit times or door events for this home until
          you turn sharing back on.
        </AlertDescription>
      </Alert>
    )
  }
  if (!data.alert) return null
  const destructive = data.alert.tone === "destructive"
  return (
    <Alert variant={destructive ? "destructive" : "warning"}>
      {destructive ? <CircleAlertIcon aria-hidden="true" /> : <ClockIcon aria-hidden="true" />}
      <AlertTitle>Today Needs Your Attention</AlertTitle>
      <AlertDescription>
        {data.alert.text} The agency has been notified and is following up.
      </AlertDescription>
    </Alert>
  )
}
