"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { MessageSquareIcon, ShieldQuestionIcon } from "lucide-react"

import { StatusBadge } from "@workspace/ui/components/status-badge"
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
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "@workspace/ui/components/toast"

import { formatDate, formatTime, formatWindow } from "@/lib/format"
import type { Note, Visit } from "@visitproof/domain"

export function CaregiverView({
  visits,
  notes,
}: {
  visits: { visit: Visit; clientName: string }[]
  notes: Note[]
}) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const active = visits.at(0)

  async function submitNote(
    classification?: "dispute" | "explanation" | "fyi"
  ) {
    if (!active || text.trim().length === 0) return
    setBusy(true)
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitId: active.visit.id,
          text: text.trim(),
          classification,
        }),
      })
      if (!response.ok) {
        toast.add({
          type: "error",
          title: "Note Not Sent",
          description: "Try again.",
        })
        return
      }
      setText("")
      toast.add({
        type: "success",
        title:
          classification === "dispute" ? "Dispute Submitted" : "Note Added",
        description: "It was signed into the record for this visit.",
      })
      router.refresh()
    } catch {
      toast.add({
        type: "error",
        title: "Note Not Sent",
        description: "Network error. Check your connection and try again.",
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Your Visit With {active.clientName}</CardTitle>
            <CardDescription>
              {formatDate(active.visit.date)},{" "}
              {formatWindow(
                active.visit.scheduledStart,
                active.visit.scheduledEnd
              )}
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={active.visit.status} />
              <span className="text-sm text-muted-foreground">
                Arrival observed at {formatTime(active.visit.arrival?.at)}.
                Departure observed at {formatTime(active.visit.departure?.at)}.
              </span>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">
                Your Notes And Disputes
              </p>
              {notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notes yet on this visit.
                </p>
              ) : (
                <ItemGroup>
                  {notes.map((note) => (
                    <Item key={note.id} variant="outline">
                      <ItemContent>
                        <ItemTitle>
                          {note.classification === "dispute"
                            ? "Dispute"
                            : "Note"}
                        </ItemTitle>
                        <ItemDescription>{note.text}</ItemDescription>
                        <ItemDescription>
                          Added {formatTime(note.at)} by {note.authorRole}
                        </ItemDescription>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              )}
            </div>
            <Separator />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="caregiver-note">Add A Note</FieldLabel>
                <Textarea
                  id="caregiver-note"
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="Explain a late arrival, an early departure, or add context for the agency."
                  rows={3}
                  maxLength={2000}
                />
                <FieldDescription>
                  Notes are signed into the evidence record. Nothing here is a
                  complaint file.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || text.trim().length === 0}
                onClick={() => submitNote()}
              >
                <MessageSquareIcon
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Submit Note
              </Button>
              <Button
                variant="outline"
                disabled={busy || text.trim().length === 0}
                onClick={() => submitNote("dispute")}
              >
                <ShieldQuestionIcon
                  data-icon="inline-start"
                  aria-hidden="true"
                />
                Mark As Dispute
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No Visits Today</EmptyTitle>
            <EmptyDescription>
              When you have a visit, your record will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {visits.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Earlier Today</CardTitle>
            <CardDescription>The rest of your schedule.</CardDescription>
          </CardHeader>
          <CardContent>
            <ItemGroup>
              {visits.slice(1).map(({ visit, clientName }) => (
                <Item key={visit.id} variant="outline">
                  <ItemContent>
                    <ItemTitle>{clientName}</ItemTitle>
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
      ) : null}
    </div>
  )
}
