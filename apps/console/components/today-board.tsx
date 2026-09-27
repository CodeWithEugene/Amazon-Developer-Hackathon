"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { ClockIcon, PhoneIcon } from "lucide-react"

import { StatusBadge } from "@workspace/ui/components/status-badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@workspace/ui/components/item"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { toast } from "@workspace/ui/components/toast"

import { formatTime, formatWindow } from "@/lib/format"
import type { Exception, Visit } from "@visitproof/domain"

export interface VisitRow {
  visit: Visit
  clientName: string
  caregiverName: string
}

export interface ExceptionRow {
  exception: Exception
  clientName: string
  caregiverName: string
  visitWindow: string
  caregiverMobile?: string
}

const EXCEPTION_COPY: Record<string, string> = {
  late_arrival: "The caregiver arrived after the grace period.",
  late_no_arrival: "No arrival observed and the grace period has passed.",
  no_show: "No arrival or departure was observed for this visit.",
  early_departure: "The caregiver left before the scheduled end.",
  unobservable: "The doorbell could not observe this visit.",
  contradicted: "The EVV clock-in contradicts the observed arrival.",
  missing_clock_in: "No EVV clock-in was recorded for this visit.",
  ambiguous: "Multiple arrivals were observed and a human decision is needed.",
}

/** Default resolve reason, also used by the backfill action. */
const DEFAULT_RESOLVE_REASON = "caregiver_confirmed"

const RESOLVE_REASONS = [
  { value: DEFAULT_RESOLVE_REASON, label: "Caregiver Confirmed Times" },
  { value: "family_confirmed", label: "Family Confirmed Times" },
  { value: "visit_completed", label: "Visit Completed As Scheduled" },
  { value: "device_issue", label: "Device Issue, Visit Occurred" },
]

export function TodayBoard({
  rows,
  exceptions,
  stats,
}: {
  rows: VisitRow[]
  exceptions: ExceptionRow[]
  stats: {
    visitsToday: number
    inProgress: number
    openExceptions: number
    unlinkedClients: number
  }
}) {
  const router = useRouter()

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Visits Today" value={stats.visitsToday} />
        <StatCard title="In Progress" value={stats.inProgress} />
        <StatCard title="Exceptions Open" value={stats.openExceptions} />
        <StatCard
          title="Unlinked Clients"
          value={stats.unlinkedClients}
          description="Ring not linked or paused"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Exception Cards</CardTitle>
          <CardDescription>
            Late arrivals, no-shows, early departures, and unobservable visits
            need a decision.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {exceptions.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>All Clear</EmptyTitle>
                <EmptyDescription>
                  No open exceptions. Today is running smoothly.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup>
              {exceptions.map((row) => (
                <ExceptionCard
                  key={row.exception.id}
                  row={row}
                  onDone={() => router.refresh()}
                />
              ))}
            </ItemGroup>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Visits Today</CardTitle>
          <CardDescription>
            Live visit status from the doorbell, per client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            {rows.map(({ visit, clientName, caregiverName }) => (
              <Item key={visit.id} variant="outline">
                <ItemContent>
                  <ItemTitle>
                    {clientName} with {caregiverName}
                  </ItemTitle>
                  <ItemDescription>
                    {formatWindow(visit.scheduledStart, visit.scheduledEnd)}.
                    Arrival {formatTime(visit.arrival?.at)}. Departure{" "}
                    {formatTime(visit.departure?.at)}.
                  </ItemDescription>
                </ItemContent>
                <StatusBadge status={visit.status} />
              </Item>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>
    </div>
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
    <Card className="py-4">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {description ? (
        <CardContent className="text-xs text-muted-foreground">
          {description}
        </CardContent>
      ) : null}
    </Card>
  )
}

function ExceptionCard({
  row,
  onDone,
}: {
  row: ExceptionRow
  onDone: () => void
}) {
  const { exception } = row
  const [busy, setBusy] = useState(false)
  const [arrival, setArrival] = useState("")
  const [departure, setDeparture] = useState("")

  async function post(
    url: string,
    body: unknown,
    successTitle: string,
    successDescription: string
  ) {
    setBusy(true)
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        toast.add({
          type: "error",
          title: "Action Failed",
          description: error?.error ?? "Try again.",
        })
        return
      }
      toast.add({
        type: "success",
        title: successTitle,
        description: successDescription,
      })
      onDone()
    } catch {
      toast.add({
        type: "error",
        title: "Action Failed",
        description: "Network error. Check your connection and try again.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Item variant="outline" className="flex-col items-stretch gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={exception.kind} />
        <Badge variant="outline">{row.clientName}</Badge>
        <span className="text-sm text-muted-foreground">
          {row.visitWindow} with {row.caregiverName}
        </span>
        <span className="sr-only">Exception kind: {exception.kind}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        {EXCEPTION_COPY[exception.kind] ?? "An exception needs review."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger render={<Button size="sm" />}>
            Backfill Times
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Backfill Visit Times</DialogTitle>
              <DialogDescription>
                Confirm the actual times with the caregiver and record them for{" "}
                {row.clientName}.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="backfill-arrival">
                  Actual Arrival
                </FieldLabel>
                <Input
                  id="backfill-arrival"
                  type="time"
                  value={arrival}
                  onChange={(event) => setArrival(event.target.value)}
                />
                <FieldDescription>
                  Leave blank if not confirming the arrival.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="backfill-departure">
                  Actual Departure
                </FieldLabel>
                <Input
                  id="backfill-departure"
                  type="time"
                  value={departure}
                  onChange={(event) => setDeparture(event.target.value)}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button
                disabled={busy || (!arrival && !departure)}
                onClick={() =>
                  post(
                    `/api/visits/${exception.visitId}/backfill`,
                    {
                      arrivalAt: arrival ? timeToIsoToday(arrival) : undefined,
                      departureAt: departure
                        ? timeToIsoToday(departure)
                        : undefined,
                      reason: DEFAULT_RESOLVE_REASON,
                    },
                    "Times Backfilled",
                    "The exception was resolved and the ledger was updated."
                  )
                }
              >
                Save Backfill
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            post(
              `/api/exceptions/${exception.id}`,
              { action: "snooze", minutes: 10 },
              "Exception Snoozed",
              "It will return to the queue in ten minutes."
            )
          }
        >
          <ClockIcon data-icon="inline-start" aria-hidden="true" />
          Snooze 10 Minutes
        </Button>
        {row.caregiverMobile ? (
          <Button
            variant="outline"
            size="sm"
            render={<a href={`tel:${row.caregiverMobile}`} />}
          >
            <PhoneIcon data-icon="inline-start" aria-hidden="true" />
            Call Caregiver
          </Button>
        ) : null}
        <ResolveButton
          disabled={busy}
          onConfirm={(reason) =>
            post(
              `/api/exceptions/${exception.id}`,
              { action: "resolve", reason },
              "Exception Resolved",
              "The resolution was signed into the ledger."
            )
          }
        />
      </div>
    </Item>
  )
}

function ResolveButton({
  disabled,
  onConfirm,
}: {
  disabled: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState(DEFAULT_RESOLVE_REASON)
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button size="sm" variant="secondary" disabled={disabled} />}
      >
        Resolve
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Resolve Exception</AlertDialogTitle>
          <AlertDialogDescription>
            Choose the confirmed reason. The resolution is signed into the
            evidence ledger.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="resolve-reason">Reason</FieldLabel>
          <Select
            items={RESOLVE_REASONS}
            value={reason}
            onValueChange={(value) =>
              setReason(value ?? DEFAULT_RESOLVE_REASON)
            }
          >
            <SelectTrigger id="resolve-reason" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOLVE_REASONS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => onConfirm(reason)}>
            Resolve Exception
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Converts an HH:MM input value to an ISO datetime on today's date. */
function timeToIsoToday(time: string): string {
  const now = new Date()
  const [hour, minute] = time.split(":").map(Number)
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      hour ?? 0,
      minute ?? 0
    )
  ).toISOString()
}
