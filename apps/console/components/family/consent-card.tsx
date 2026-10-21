"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Switch } from "@workspace/ui/components/switch"

import type { FamilyData } from "@/lib/views/family"

import { useApiAction } from "../use-api-action"

const RETENTION_OPTIONS = [
  { value: "1", label: "1 Day" },
  { value: "7", label: "7 Days" },
  { value: "30", label: "30 Days" },
]

type ConsentKey = "shareWithAgency" | "snapshotsEnabled" | "exceptionAlerts"

const SWITCHES: readonly {
  key: ConsentKey
  label: string
  description: string
  on: string
  off: string
}[] = [
  {
    key: "shareWithAgency",
    label: "Share Visit Times With Agency",
    description: "Arrival and departure times only. Turning this off hides visit details from the agency right away.",
    on: "Sharing Enabled",
    off: "Sharing Paused",
  },
  {
    key: "snapshotsEnabled",
    label: "Doorbell Snapshots",
    description: "One still image at arrival, kept with an expiry, never video.",
    on: "Snapshots Enabled",
    off: "Snapshots Off",
  },
  {
    key: "exceptionAlerts",
    label: "Exception Alerts",
    description: "Show an alert when something about today's visit needs attention.",
    on: "Alerts On",
    off: "Alerts Off",
  },
]

export function ConsentCard({ data }: { data: FamilyData }) {
  const { busy, run } = useApiAction()
  const { consent } = data.client
  const locked = busy || data.erased

  const patch = (body: Record<string, unknown>, title: string) =>
    run("/api/family/consent", {
      method: "PATCH",
      body: { clientId: data.client.id, ...body },
      success: { title, description: "Your choice was saved." },
      failureTitle: "Could Not Save",
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Consent Controls</CardTitle>
        <CardDescription>
          {data.erased
            ? "Your data was deleted, so there is nothing left to share. Link Ring again to start over."
            : "Choose what the agency can see. Change anything at any time."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {SWITCHES.map((item) => (
            <ConsentSwitch
              key={item.key}
              item={item}
              checked={consent[item.key]}
              disabled={locked}
              onChange={(checked) => patch({ [item.key]: checked }, checked ? item.on : item.off)}
            />
          ))}
          <RetentionField
            value={consent.snapshotRetentionDays}
            disabled={locked}
            onChange={(days) => patch({ snapshotRetentionDays: days }, "Snapshot Expiry Saved")}
          />
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function RetentionField({
  value,
  disabled,
  onChange,
}: {
  value: number
  disabled: boolean
  onChange: (days: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor="consent-expiry">Snapshot Expiry</FieldLabel>
      <Select
        items={RETENTION_OPTIONS}
        value={String(value)}
        onValueChange={(next) => onChange(Number(next ?? 7))}
      >
        <SelectTrigger id="consent-expiry" disabled={disabled} className="w-full">
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
      <FieldDescription>Snapshots are deleted automatically when they expire.</FieldDescription>
    </Field>
  )
}

function ConsentSwitch({
  item,
  checked,
  disabled,
  onChange,
}: {
  item: (typeof SWITCHES)[number]
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={`consent-${item.key}`}>{item.label}</FieldLabel>
        <FieldDescription>{item.description}</FieldDescription>
      </FieldContent>
      <Switch
        id={`consent-${item.key}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
    </Field>
  )
}
