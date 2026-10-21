import type { AskContext, BrainResult } from "./brain"
import type { PendingConfirmation, ToolCallRecord } from "./types"

/**
 * Write intents for the fixture brain. The first call goes out without
 * `confirmed`, so the server answers "confirmation_required" and the turn
 * carries the pending call; a following "yes" replays it with confirmed true.
 */
const pendingFrom = (record: ToolCallRecord): PendingConfirmation | undefined =>
  record.structuredContent?.status === "confirmation_required" &&
  (record.name === "acknowledge_exception" || record.name === "add_visit_note")
    ? { name: record.name, arguments: record.arguments }
    : undefined

const finish = (calls: ToolCallRecord[], reasoning: string): BrainResult => {
  const last = calls.at(-1)
  const pending = last ? pendingFrom(last) : undefined
  return { calls, spoken: last?.text ?? "", reasoning, ...(pending ? { pendingConfirmation: pending } : {}) }
}

const NOTE_LEAD = /^.*?\b(tell the agency|let the agency know|add a note|leave a note|note that)\b\s*(that\s+)?/i

export async function addNote(context: AskContext): Promise<BrainResult> {
  const text = context.utterance.replace(NOTE_LEAD, "").replace(/[.?!]+$/, "").trim()
  const calls: ToolCallRecord[] = []
  const explicit = context.utterance.match(/\bv_[a-z0-9_]+\b/i)?.[0]
  let visitId = explicit
  if (!visitId) {
    const listing = await context.caller.callTool("list_visits", {})
    calls.push(listing)
    const visits = (listing.structuredContent?.visits ?? []) as Array<{ visitId: string; status?: string }>
    visitId = (visits.find((visit) => visit.status === "scheduled" || visit.status === "awaiting_arrival") ?? visits.at(-1))?.visitId
  }
  if (!visitId || !text) {
    return { calls, spoken: "I could not tell which visit or what to say. Try: tell the agency I will be there Thursday.", reasoning: "note intent without a visit or text" }
  }
  calls.push(await context.caller.callTool("add_visit_note", { visitId, text }))
  return finish(calls, "asks to pass a message to the agency; add_visit_note on the next visit, confirmation first")
}

const KIND_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/no[- ]?show/i, "no_show"],
  [/late/i, "late_arrival"],
  [/unobserv|offline|could not be observed/i, "unobservable"],
  [/clock[- ]?in/i, "missing_clock_in"],
  [/early/i, "early_departure"],
]

export async function acknowledge(context: AskContext): Promise<BrainResult> {
  if (context.persona !== "agency") {
    return { calls: [], spoken: "Only the agency can acknowledge exceptions.", reasoning: "acknowledge intent from a family persona" }
  }
  const listing = await context.caller.callTool("list_exceptions", {})
  const exceptions = (listing.structuredContent?.exceptions ?? []) as Array<{ exceptionId: string; kind: string; clientFirstName?: string }>
  const kind = KIND_WORDS.find(([pattern]) => pattern.test(context.utterance))?.[1]
  const target =
    exceptions.find((item) => (!kind || item.kind === kind) && (!item.clientFirstName || new RegExp(`\\b${item.clientFirstName}\\b`, "i").test(context.utterance))) ??
    exceptions.find((item) => !kind || item.kind === kind)
  if (!target) return { calls: [listing], spoken: "I could not find an open exception like that.", reasoning: "acknowledge intent with no matching open exception" }
  const reason = context.utterance.match(/\bbecause\s+(.+?)[.?!]?$/i)?.[1]?.trim().replace(/\s+/g, "_").toLowerCase() ?? "acknowledged_by_voice"
  const calls = [listing, await context.caller.callTool("acknowledge_exception", { exceptionId: target.exceptionId, reason })]
  return finish(calls, "asks to acknowledge an exception; list_exceptions to find it, then acknowledge_exception with confirmation")
}
