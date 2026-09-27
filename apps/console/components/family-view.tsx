"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  DownloadIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react"

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
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Button } from "@workspace/ui/components/button"
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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
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
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "@workspace/ui/components/toast"

import { formatDate, formatTime } from "@/lib/format"
import type { Client, Exception, Visit } from "@visitproof/domain"

const RETENTION_OPTIONS = [
  { value: "1", label: "1 Day" },
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
]

const EXCEPTION_TEXT: Record<string, string> = {
  late_arrival: "The caregiver arrived later than scheduled today.",
  no_show: "No caregiver arrival was observed at the door today.",
  early_departure: "The caregiver left earlier than scheduled today.",
  unobservable: "The doorbell could not observe today's visit.",
  contradicted: "A clock-in was reported that does not match the door.",
  missing_clock_in: "No clock-in was recorded for today's visit.",
  late_no_arrival: "The visit window has passed with no arrival observed.",
  ambiguous: "Today's visit needs a human review.",
}

export function FamilyView({
  client,
  visit,
  exceptions,
}: {
  client: Client
  visit: Visit | null
  exceptions: Exception[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function patchConsent(patch: Record<string, unknown>, title: string) {
    setBusy(true)
    try {
      const response = await fetch("/api/family/consent", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, ...patch }),
      })
      if (!response.ok) {
        toast.add({
          type: "error",
          title: "Could Not Save",
          description: "Try again.",
        })
        return
      }
      toast.add({
        type: "success",
        title,
        description: "Your choice was saved.",
      })
      router.refresh()
    } catch {
      toast.add({
        type: "error",
        title: "Could Not Save",
        description: "Network error. Check your connection and try again.",
      })
    } finally {
      setBusy(false)
    }
  }

  async function deleteEverything() {
    setBusy(true)
    try {
      const response = await fetch("/api/family/data", { method: "DELETE" })
      if (!response.ok) {
        toast.add({
          type: "error",
          title: "Could Not Delete",
          description: "Try again.",
        })
        return
      }
      toast.add({
        type: "success",
        title: "Sharing Stopped",
        description:
          "The doorbell link was removed and consent withdrawn. Existing records are kept in this demo.",
      })
      router.refresh()
    } catch {
      toast.add({
        type: "error",
        title: "Could Not Delete",
        description: "Network error. Check your connection and try again.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {exceptions.length > 0 ? (
        <div className="flex flex-col gap-2">
          {exceptions.map((exception) => (
            <Alert key={exception.id} variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>Today Needs Your Attention</AlertTitle>
              <AlertDescription>
                {EXCEPTION_TEXT[exception.kind] ??
                  "An exception was raised for today's visit."}{" "}
                The agency has been notified and is following up.
              </AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {visit
              ? visit.arrival
                ? "The caregiver came today"
                : "No caregiver arrival observed yet today"
              : "No visit is scheduled today"}
          </CardTitle>
          <CardDescription>
            {visit
              ? `Scheduled ${formatTime(visit.scheduledStart)} to ${formatTime(visit.scheduledEnd)}.`
              : "You will get one message here when a visit is scheduled."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visit ? (
            <ItemGroup>
              <Item variant="outline">
                <ItemContent>
                  <ItemTitle>{formatDate(visit.date)}</ItemTitle>
                  <ItemDescription>
                    {visit.arrival
                      ? `The caregiver arrived at ${formatTime(visit.arrival.at)}`
                      : "No arrival observed so far"}
                    {visit.departure
                      ? ` and left at ${formatTime(visit.departure.at)}.`
                      : "."}
                  </ItemDescription>
                  {visit.narrative ? (
                    <p className="text-sm text-muted-foreground">
                      {visit.narrative.text}
                    </p>
                  ) : null}
                </ItemContent>
                <StatusBadge status={visit.status} />
              </Item>
            </ItemGroup>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Nothing Today</EmptyTitle>
                <EmptyDescription>
                  When a visit is scheduled, one calm message will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <ShieldCheckIcon
                className="size-5 text-muted-foreground"
                aria-hidden="true"
              />
              Consent Controls
            </span>
          </CardTitle>
          <CardDescription>
            Granular controls for what the agency can see. Change anything at
            any time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <FieldLabel htmlFor="consent-share">
                    Share Visit Times With Agency
                  </FieldLabel>
                  <FieldDescription>
                    Arrival and departure times only.
                  </FieldDescription>
                </div>
                <Switch
                  id="consent-share"
                  checked={client.consent.shareWithAgency}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    patchConsent(
                      { shareWithAgency: checked === true },
                      checked ? "Sharing Enabled" : "Sharing Paused"
                    )
                  }
                />
              </div>
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <FieldLabel htmlFor="consent-snapshots">
                    Doorbell Snapshots
                  </FieldLabel>
                  <FieldDescription>
                    One still image at arrival, kept with an expiry, never
                    video.
                  </FieldDescription>
                </div>
                <Switch
                  id="consent-snapshots"
                  checked={client.consent.snapshotsEnabled}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    patchConsent(
                      { snapshotsEnabled: checked === true },
                      checked ? "Snapshots Enabled" : "Snapshots Off"
                    )
                  }
                />
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="consent-expiry">Snapshot Expiry</FieldLabel>
              <Select
                items={RETENTION_OPTIONS}
                value={String(client.consent.snapshotRetentionDays)}
                onValueChange={(value) =>
                  patchConsent(
                    { snapshotRetentionDays: Number(value ?? 7) },
                    "Snapshot Expiry Saved"
                  )
                }
              >
                <SelectTrigger
                  id="consent-expiry"
                  disabled={busy}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RETENTION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Snapshots are deleted automatically when they expire.
              </FieldDescription>
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <FieldLabel htmlFor="consent-alerts">
                    Exception Alerts
                  </FieldLabel>
                  <FieldDescription>
                    Get notified when something needs attention.
                  </FieldDescription>
                </div>
                <Switch
                  id="consent-alerts"
                  checked={client.consent.exceptionAlerts}
                  disabled={busy}
                  onCheckedChange={(checked) =>
                    patchConsent(
                      { exceptionAlerts: checked === true },
                      checked ? "Alerts On" : "Alerts Off"
                    )
                  }
                />
              </div>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your Data</CardTitle>
          <CardDescription>
            Export everything, or cut the link and withdraw consent, in one tap.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={<a href="/api/family/data" download />}
          >
            <DownloadIcon data-icon="inline-start" aria-hidden="true" />
            Export My Data
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={busy} />}
            >
              <Trash2Icon data-icon="inline-start" aria-hidden="true" />
              Delete Everything
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Everything?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the doorbell link and withdraws every consent, so
                  the agency stops receiving anything new from this household.
                  In this demo your existing visits, notes, and evidence are
                  kept; in production a scheduled erasure job deletes them
                  permanently.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep My Data</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={deleteEverything}
                >
                  Delete Everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
