"use client"

import Link from "next/link"
import { ClockIcon, FileSearchIcon, PhoneIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemHeader,
  ItemTitle,
} from "@workspace/ui/components/item"
import { StatusBadge } from "@workspace/ui/components/status-badge"

import { AGENCY_EXCEPTION_TEXT } from "@/lib/labels"
import type { BoardExceptionRow } from "@/lib/views/today"

import { useApiAction } from "../use-api-action"
import { BackfillDialog, type BackfillValues } from "./backfill-dialog"
import { ResolveDialog } from "./resolve-dialog"

const SNOOZE_MINUTES = 10

export function ExceptionCard({
  row,
  timeZoneLabel,
}: {
  row: BoardExceptionRow
  timeZoneLabel: string
}) {
  const { busy, run } = useApiAction()
  const exceptionUrl = `/api/exceptions/${encodeURIComponent(row.id)}`

  const backfill = (values: BackfillValues) =>
    run(`/api/visits/${encodeURIComponent(row.visitId)}/backfill`, {
      body: { ...values, exceptionId: row.id },
      success: {
        title: "Correction Saved",
        description: "The agency correction was signed into the Resolved column.",
      },
    })

  return (
    <Item variant="outline">
      <ItemHeader>
        <StatusBadge status={row.kind} />
        <span className="text-xs text-muted-foreground">
          {row.visitDateLabel ?? "Visit record unavailable"}
        </span>
      </ItemHeader>
      <ItemContent>
        <ItemTitle>{row.clientName}</ItemTitle>
        <ItemDescription>
          {row.visitWindow ?? "Window unknown"} with {row.caregiverName}.{" "}
          {AGENCY_EXCEPTION_TEXT[row.kind]}
          {row.snoozedUntilLabel ? ` Snoozed until ${row.snoozedUntilLabel}.` : ""}
        </ItemDescription>
      </ItemContent>
      <ItemFooter>
        <ItemActions className="flex-wrap">
          <BackfillDialog
            row={row}
            timeZoneLabel={timeZoneLabel}
            disabled={busy}
            onSubmit={backfill}
          />
          {row.group === "snoozed" ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                run(exceptionUrl, {
                  body: { action: "snooze", minutes: SNOOZE_MINUTES },
                  success: {
                    title: "Exception Snoozed",
                    description: "It will return to the board in ten minutes.",
                  },
                })
              }
            >
              <ClockIcon data-icon="inline-start" aria-hidden="true" />
              Snooze 10 Minutes
            </Button>
          )}
          {row.caregiverMobile ? (
            <Button
              variant="outline"
              size="sm"
              render={<a href={`tel:${row.caregiverMobile}`} />}
              nativeButton={false}
            >
              <PhoneIcon data-icon="inline-start" aria-hidden="true" />
              Call Caregiver
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            render={<Link href={`/agency/visits/${encodeURIComponent(row.visitId)}`} />}
            nativeButton={false}
          >
            <FileSearchIcon data-icon="inline-start" aria-hidden="true" />
            View Visit
          </Button>
          <ResolveDialog
            id={row.id}
            disabled={busy}
            onConfirm={(reason) =>
              run(exceptionUrl, {
                body: { action: "resolve", reason },
                success: {
                  title: "Exception Resolved",
                  description: "The resolution was signed into the ledger.",
                },
              })
            }
          />
        </ItemActions>
      </ItemFooter>
    </Item>
  )
}
