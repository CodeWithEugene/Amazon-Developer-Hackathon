import "server-only"

import { newId } from "@visitproof/db"
import type { Note } from "@visitproof/domain"

import { notFound } from "./errors"
import { appendLedger } from "./ledger"
import { getVisit } from "./reads"
import { getStore } from "./repository"

export interface NoteInput {
  visitId: string
  authorRole: Note["authorRole"]
  authorId: string
  text: string
  classification?: Note["classification"]
}

const AGENCY_ROLES: readonly Note["authorRole"][] = [
  "agency_admin",
  "agency_staff",
  "system",
]

/**
 * Adds a signed note. Family and caregiver notes belong to the Reported
 * column; agency notes to the Resolved column. The ledger record is
 * appended before the note is stored.
 */
export async function addNote(input: NoteInput): Promise<Note> {
  const store = getStore()
  const visit = (await getVisit(input.visitId)) ?? notFound("Visit")
  const nowIso = new Date().toISOString()
  const note: Note = {
    id: newId(),
    visitId: input.visitId,
    authorRole: input.authorRole,
    authorId: input.authorId,
    at: nowIso,
    text: input.text,
    ...(input.classification ? { classification: input.classification } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  }
  const column = AGENCY_ROLES.includes(note.authorRole) ? "resolved" : "reported"
  await appendLedger(store, visit.clientId, column, note.id, {
    visitId: note.visitId,
    authorRole: note.authorRole,
    classification: note.classification ?? null,
    text: note.text,
  })
  await store.evidence.putNote(note)
  return note
}
