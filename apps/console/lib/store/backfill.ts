import "server-only"

import { newId } from "@visitproof/db"
import type { Exception, Note, Visit } from "@visitproof/domain"

import { getAgencyTimeZone } from "./agency"
import {
  CORRECTABLE_KINDS,
  correctionText,
  planCorrection,
  type CorrectionInput,
} from "./correction"
import { ConflictError, notFound } from "./errors"
import { resolved } from "./exception-state"
import { appendLedger } from "./ledger"
import { getVisit } from "./reads"
import { AGENCY_ID, getStore } from "./repository"

export type BackfillInput = CorrectionInput

export interface CorrectionResult {
  /** The visit, unchanged: observed times are the engine's alone. */
  visit: Visit
  note: Note
  resolvedExceptions: Exception[]
}

const DEFAULT_REASON = "caregiver_confirmed"

async function targetExceptions(
  visitId: string,
  exceptionId: string | undefined
): Promise<Exception[]> {
  const all = await getStore().exceptions.byAgency(AGENCY_ID)
  const forVisit = all.filter((e) => e.visitId === visitId)
  if (!exceptionId) {
    return forVisit.filter(
      (e) => e.state !== "resolved" && CORRECTABLE_KINDS.includes(e.kind)
    )
  }
  const target = forVisit.find((e) => e.id === exceptionId) ?? notFound("Exception")
  if (target.state === "resolved") {
    throw new ConflictError("This exception is already resolved.")
  }
  return [target]
}

/**
 * Records an agency correction (contract C2): a signed "resolved" ledger
 * record first, then an agency note carrying the corrected times, then the
 * resolutions of the exceptions the correction answers. The visit's
 * observed arrival, departure, status, and reconciliation stay as the door
 * evidence left them.
 */
export async function recordAgencyCorrection(
  visitId: string,
  input: CorrectionInput,
  actor: string
): Promise<CorrectionResult> {
  const store = getStore()
  const visit = (await getVisit(visitId)) ?? notFound("Visit")
  const timeZone = await getAgencyTimeZone()
  const now = new Date()
  const plan = planCorrection(visit, input, timeZone, now)
  const reason = input.reason ?? DEFAULT_REASON
  const targets = await targetExceptions(visitId, input.exceptionId)
  const text = [correctionText(plan, reason, timeZone), input.note]
    .filter(Boolean)
    .join(" ")
  const nowIso = now.toISOString()
  const note: Note = {
    id: newId(),
    visitId,
    authorRole: "agency_staff",
    authorId: actor,
    at: nowIso,
    text,
    createdAt: nowIso,
    updatedAt: nowIso,
    version: 1,
  }
  await appendLedger(store, visit.clientId, "resolved", visitId, {
    action: "agency_correction",
    by: actor,
    reason,
    correctedArrival: plan.arrivalAt ?? null,
    correctedDeparture: plan.departureAt ?? null,
    observedArrival: visit.arrival?.at ?? null,
    observedDeparture: visit.departure?.at ?? null,
    noteId: note.id,
    exceptionIds: targets.map((e) => e.id),
  })
  await store.evidence.putNote(note)
  const resolvedExceptions = targets.map((e) =>
    resolved(e, { by: actor, reason, note: text }, now)
  )
  for (const exception of resolvedExceptions) {
    await store.exceptions.put(exception)
  }
  return { visit, note, resolvedExceptions }
}

/** Backward-compatible entry point; returns the (unchanged) visit. */
export async function backfillVisit(
  visitId: string,
  input: BackfillInput,
  actor: string
): Promise<Visit> {
  return (await recordAgencyCorrection(visitId, input, actor)).visit
}
