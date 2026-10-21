"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"

import type { BoardExceptionRow } from "@/lib/views/today"

import { DEFAULT_REASON, ReasonSelect } from "./reason-select"

export interface BackfillValues {
  arrivalLocal?: string
  departureLocal?: string
  reason: string
}

/** Client-side check; the server repeats it against the visit day. */
function validate(arrival: string, departure: string): string | null {
  if (!arrival && !departure) return "Enter an arrival time, a departure time, or both."
  if (arrival && departure && departure <= arrival) {
    return "The departure must be after the arrival."
  }
  return null
}

export function BackfillDialog({
  row,
  timeZoneLabel,
  disabled,
  onSubmit,
}: {
  row: BoardExceptionRow
  timeZoneLabel: string
  disabled: boolean
  onSubmit: (values: BackfillValues) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [arrival, setArrival] = useState("")
  const [departure, setDeparture] = useState("")
  const [reason, setReason] = useState<string>(DEFAULT_REASON)
  const [touched, setTouched] = useState(false)
  const error = touched ? validate(arrival, departure) : null
  const idBase = `backfill-${row.id}`

  async function save() {
    setTouched(true)
    if (validate(arrival, departure)) return
    const ok = await onSubmit({
      ...(arrival ? { arrivalLocal: arrival } : {}),
      ...(departure ? { departureLocal: departure } : {}),
      reason,
    })
    if (ok) setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" disabled={disabled} />}>
        Backfill Times
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Backfill Visit Times</DialogTitle>
          <DialogDescription>
            Record the times the caregiver confirmed for {row.clientName} on{" "}
            {row.visitDateLabel ?? "the visit day"} ({row.visitWindow ?? "window unknown"}).
            This is saved as an agency correction in the Resolved column. The
            door observations are never changed.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${idBase}-arrival`}>Actual Arrival</FieldLabel>
            <Input
              id={`${idBase}-arrival`}
              type="time"
              value={arrival}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setArrival(event.target.value)}
            />
            <FieldDescription>
              Agency time ({timeZoneLabel}) on the visit day. Leave blank if not
              confirming the arrival.
            </FieldDescription>
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={`${idBase}-departure`}>Actual Departure</FieldLabel>
            <Input
              id={`${idBase}-departure`}
              type="time"
              value={departure}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setDeparture(event.target.value)}
            />
            <FieldError>{error}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${idBase}-reason`}>Reason</FieldLabel>
            <ReasonSelect id={`${idBase}-reason`} value={reason} onChange={setReason} />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={disabled} onClick={save}>
            Save Correction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
