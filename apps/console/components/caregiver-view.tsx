"use client"

import Link from "next/link"
import { useState } from "react"
import {
  CalendarXIcon,
  FileSearchIcon,
  MessageSquareIcon,
  ShieldQuestionIcon,
  TriangleAlertIcon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@workspace/ui/components/alert"
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
  EmptyMedia,
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
import { Separator } from "@workspace/ui/components/separator"
import { StatusBadge } from "@workspace/ui/components/status-badge"
import { Textarea } from "@workspace/ui/components/textarea"

import type { CaregiverData, CaregiverVisit, NoteRow } from "@/lib/views/caregiver"

import { useApiAction } from "./use-api-action"

export function CaregiverView({ data }: { data: CaregiverData }) {
  if (!data.selected) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarXIcon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No Visits In The Last Two Weeks</EmptyTitle>
          <EmptyDescription>When you have a visit, your record will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <SelectedVisitCard visit={data.selected} notes={data.notes} />
      <VisitHistory data={data} selectedId={data.selected.id} />
    </div>
  )
}

function SelectedVisitCard({ visit, notes }: { visit: CaregiverVisit; notes: NoteRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Visit With {visit.clientName}</CardTitle>
        <CardDescription>
          {visit.dateLabel}, {visit.window}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {visit.missingClockInWithDoor ? (
          <Alert variant="warning">
            <TriangleAlertIcon aria-hidden="true" />
            <AlertTitle>Missing Clock-In With Door Presence</AlertTitle>
            <AlertDescription>
              The door saw a person arrive at {visit.doorArrival}, but no EVV
              clock-in was recorded. Add a note to explain, or mark it as a
              dispute if the record is wrong.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={visit.status} />
          <StatusBadge status={visit.outcome} />
        </div>
        <p className="text-sm text-muted-foreground">
          {visit.doorSummary} {visit.clockInSummary}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          render={<Link href={`/me/visits/${encodeURIComponent(visit.id)}`} />}
          nativeButton={false}
        >
          <FileSearchIcon data-icon="inline-start" aria-hidden="true" />
          Open Full Record
        </Button>
        <NotesList notes={notes} />
        <Separator />
        <NoteForm key={visit.id} visitId={visit.id} />
      </CardContent>
    </Card>
  )
}

function NotesList({ notes }: { notes: NoteRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Notes And Disputes On This Visit</h3>
      {notes.length === 0 ? (
        <Empty className="p-4">
          <EmptyHeader>
            <EmptyTitle>No Notes Yet</EmptyTitle>
            <EmptyDescription>Anything you add below is signed onto this visit.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {notes.map((note) => (
            <Item key={note.id} variant="outline">
              <ItemContent>
                <ItemTitle>{note.title}</ItemTitle>
                <ItemDescription className="line-clamp-none">{note.text}</ItemDescription>
                <ItemDescription>{note.meta}</ItemDescription>
              </ItemContent>
            </Item>
          ))}
        </ItemGroup>
      )}
    </section>
  )
}

function NoteForm({ visitId }: { visitId: string }) {
  const [text, setText] = useState("")
  const { busy, run } = useApiAction()
  const empty = text.trim().length === 0

  async function submit(classification?: "dispute") {
    if (empty) return
    const ok = await run("/api/notes", {
      body: { visitId, text: text.trim(), ...(classification ? { classification } : {}) },
      success: {
        title: classification === "dispute" ? "Dispute Submitted" : "Note Added",
        description: "It was signed into the Reported column for this visit.",
      },
      failureTitle: "Note Not Sent",
    })
    if (ok) setText("")
  }

  return (
    <>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="caregiver-note">Add A Note</FieldLabel>
          <Textarea
            id="caregiver-note"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Explain a late arrival, a missing clock-in, or add context for the agency."
            rows={3}
            maxLength={2000}
          />
          <FieldDescription>
            Notes are signed into the evidence record for the visit shown above.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || empty} onClick={() => submit()}>
          <MessageSquareIcon data-icon="inline-start" aria-hidden="true" />
          Submit Note
        </Button>
        <Button variant="outline" disabled={busy || empty} onClick={() => submit("dispute")}>
          <ShieldQuestionIcon data-icon="inline-start" aria-hidden="true" />
          Mark As Dispute
        </Button>
      </div>
    </>
  )
}

function VisitHistory({ data, selectedId }: { data: CaregiverData; selectedId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>My Last Two Weeks</CardTitle>
        <CardDescription>Your own visits, newest first. Choose one to add a note.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.days.map((day) => (
          <section key={day.dayKey} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{day.dateLabel}</h3>
            <ItemGroup className="gap-2">
              {day.visits.map((visit) => (
                <Item
                  key={visit.id}
                  variant={visit.id === selectedId ? "muted" : "outline"}
                  render={<Link href={`/me?visit=${encodeURIComponent(visit.id)}`} scroll={false} />}
                  aria-current={visit.id === selectedId ? "true" : undefined}
                >
                  <ItemContent className="min-w-0 basis-full sm:basis-0">
                    <ItemTitle className="line-clamp-none">{visit.clientName}</ItemTitle>
                    <ItemDescription className="line-clamp-none">
                      {visit.window}. {visit.doorSummary} {visit.clockInSummary}
                    </ItemDescription>
                  </ItemContent>
                  <StatusBadge status={visit.missingClockInWithDoor ? "missing_clock_in" : visit.outcome} />
                </Item>
              ))}
            </ItemGroup>
          </section>
        ))}
      </CardContent>
    </Card>
  )
}
