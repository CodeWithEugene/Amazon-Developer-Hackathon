"use client"

import { useState } from "react"

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
import { Button } from "@workspace/ui/components/button"
import { Field, FieldLabel } from "@workspace/ui/components/field"

import { ReasonSelect, DEFAULT_REASON } from "./reason-select"

export function ResolveDialog({
  id,
  disabled,
  onConfirm,
}: {
  id: string
  disabled: boolean
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState<string>(DEFAULT_REASON)
  const [open, setOpen] = useState(false)
  const fieldId = `resolve-reason-${id}`
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
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
            evidence ledger and cannot be overwritten later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor={fieldId}>Reason</FieldLabel>
          <ReasonSelect id={fieldId} value={reason} onChange={setReason} />
        </Field>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              setOpen(false)
              onConfirm(reason)
            }}
          >
            Resolve Exception
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
