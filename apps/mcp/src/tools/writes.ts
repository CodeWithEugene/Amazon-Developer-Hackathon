import { randomUUID } from "node:crypto"

import { signLedger, type Exception, type LedgerRecord, type Note } from "@visitproof/domain"

import {
  agencyMaySee,
  nowOf,
  principalOf,
  requireAgency,
  resolveClient,
  ToolError,
  type ToolContext,
} from "./context"

export type WriteStatus = "done" | "confirmation_required" | "declined" | "already_resolved"

export interface WriteResult {
  spoken: string
  status: WriteStatus
  confirmationMethod?: "elicitation" | "confirmed_argument"
  exceptionId?: string
  noteId?: string
  visitId?: string
  ledgerSeq?: number
}

type Confirmation = { outcome: "confirmed"; method: "elicitation" | "confirmed_argument" } | { outcome: "declined" | "needed" }

/**
 * Writes need explicit consent: elicitation when the client supports it, the
 * `confirmed` argument otherwise (the Alexa+ client declares no elicitation).
 */
const confirm = async (context: ToolContext, message: string, confirmed?: boolean): Promise<Confirmation> => {
  if (confirmed === true) return { outcome: "confirmed", method: "confirmed_argument" }
  if (confirmed === false) return { outcome: "declined" }
  if (!context.elicit) return { outcome: "needed" }
  return (await context.elicit(message)) === "accepted"
    ? { outcome: "confirmed", method: "elicitation" }
    : { outcome: "declined" }
}

const LEDGER_ATTEMPTS = 3

/** Appends a signed record to the client's hash chain, retrying on a seq race. */
const appendSigned = async (
  context: ToolContext,
  input: { clientId: string; column: LedgerRecord["column"]; subject: string; payload: unknown; at: string },
): Promise<LedgerRecord> => {
  requireSigner(context)
  const signer = context.signer!
  let lastError: unknown
  for (let attempt = 0; attempt < LEDGER_ATTEMPTS; attempt += 1) {
    const prev = (await context.repo.listLedger(input.clientId)).at(-1)
    const record = signLedger({
      ...input,
      seq: (prev?.seq ?? 0) + 1,
      signerKeyId: signer.keyId,
      ...(prev ? { prev } : {}),
      sign: signer.sign,
    })
    try {
      await context.repo.appendLedger(record)
      return record
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Could not append to the ledger after ${LEDGER_ATTEMPTS} attempts`, { cause: lastError })
}

const unconfirmed = (outcome: "declined" | "needed", prompt: string, ids: Partial<WriteResult>): WriteResult =>
  outcome === "needed"
    ? { spoken: `${prompt} Say yes to confirm.`, status: "confirmation_required", ...ids }
    : { spoken: "Okay, I did not change anything.", status: "declined", ...ids }

const requireSigner = (context: ToolContext): void => {
  if (!context.signer) throw new ToolError("Signing is not configured on this server, so nothing was written.", "unavailable")
}

/** acknowledge_exception: resolve an open exception with a reason (agency only). */
export async function acknowledgeException(
  args: { exceptionId: string; reason: string; confirmed?: boolean },
  context: ToolContext,
): Promise<WriteResult> {
  requireAgency(context, "acknowledge exceptions")
  requireSigner(context)
  const exception = await context.repo.getException(args.exceptionId)
  if (!exception) throw new ToolError("I could not find that exception.", "not_found")
  if (exception.state === "resolved") {
    return { spoken: "That exception is already resolved.", status: "already_resolved", exceptionId: exception.id }
  }
  const kind = exception.kind.replace(/_/g, " ")
  const reason = args.reason.replace(/_/g, " ")
  const confirmation = await confirm(context, `Acknowledge the ${kind} exception with the reason "${reason}"?`, args.confirmed)
  if (confirmation.outcome !== "confirmed") {
    return unconfirmed(confirmation.outcome, `I will acknowledge the ${kind} exception with the reason "${reason}".`, { exceptionId: exception.id })
  }
  const at = nowOf(context).toISOString()
  const resolved: Exception = {
    ...exception,
    state: "resolved",
    resolution: { by: principalOf(context).subject, at, reason: args.reason, note: "Acknowledged through Ask VisitProof." },
    updatedAt: at,
    version: exception.version + 1,
  }
  await context.repo.saveException(resolved)
  const record = await appendSigned(context, {
    clientId: exception.clientId, column: "resolved", subject: exception.id, payload: { kind: exception.kind, reason: args.reason }, at,
  })
  return {
    spoken: `Done. The ${kind} exception is acknowledged and signed into the Resolved column.`,
    status: "done",
    confirmationMethod: confirmation.method,
    exceptionId: exception.id,
    ledgerSeq: record.seq,
  }
}

/** add_visit_note: a signed note in the Reported column (family or agency). */
export async function addVisitNote(
  args: { visitId: string; text: string; confirmed?: boolean },
  context: ToolContext,
): Promise<WriteResult> {
  requireSigner(context)
  const visit = await context.repo.getVisit(args.visitId)
  if (!visit) throw new ToolError("I could not find that visit.", "not_found")
  const client = await resolveClient(context, visit.clientId)
  const principal = principalOf(context)
  if (principal.kind === "agency" && !agencyMaySee(client)) {
    throw new ToolError("The family has turned off sharing with the agency, so notes cannot be added.", "forbidden")
  }
  const confirmation = await confirm(context, `Add this note to the visit: "${args.text}"?`, args.confirmed)
  if (confirmation.outcome !== "confirmed") {
    return unconfirmed(confirmation.outcome, `I will add this note to the visit: "${args.text}".`, { visitId: visit.id })
  }
  const at = nowOf(context).toISOString()
  const note: Note = {
    id: `note_${randomUUID()}`,
    visitId: visit.id,
    authorRole: principal.kind === "family" ? "family" : "agency_staff",
    authorId: principal.subject,
    at,
    text: args.text,
    createdAt: at,
    updatedAt: at,
    version: 1,
  }
  await context.repo.saveNote(note)
  const record = await appendSigned(context, { clientId: visit.clientId, column: "reported", subject: note.id, payload: note.text, at })
  return {
    spoken: "Done. Your note is saved and signed into the Reported column.",
    status: "done",
    confirmationMethod: confirmation.method,
    noteId: note.id,
    visitId: visit.id,
    ledgerSeq: record.seq,
  }
}

