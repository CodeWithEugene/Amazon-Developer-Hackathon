import { addDays, localDateKey } from "../time"
import type { AskContext, BrainResult } from "./brain"
import { acknowledge, addNote } from "./fixture-writes"
import type { ToolCallRecord } from "./types"

/**
 * The fixture brain: deterministic rules that map an utterance to VisitProof
 * MCP tool calls (MODEL_PROVIDER=fixture). It is the offline fallback for the
 * Strands agent and the reference the golden utterances are checked against.
 */
interface Rule {
  readonly intent: string
  readonly matches: (utterance: string, context: AskContext) => boolean
  readonly run: (context: AskContext) => Promise<BrainResult>
}

const has = (pattern: RegExp) => (utterance: string) => pattern.test(utterance)

const rangeOf = (utterance: string): "week" | "two_weeks" | "month" =>
  /\bmonth\b/i.test(utterance) ? "month" : /\btwo weeks\b|\bfortnight\b/i.test(utterance) ? "two_weeks" : "week"

const daysOf = (utterance: string): number | undefined =>
  /\bmonth\b/i.test(utterance) ? 30 : /\bweek\b/i.test(utterance) ? 7 : undefined

const dateOf = (context: AskContext): string | undefined => {
  const today = localDateKey(context.now(), context.timeZone)
  if (/\byesterday\b/i.test(context.utterance)) return addDays(today, -1)
  return context.utterance.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
}

const withDate = (context: AskContext, args: Record<string, unknown> = {}) => {
  const date = dateOf(context)
  return date ? { ...args, date } : args
}

export const spokenOf = (calls: readonly ToolCallRecord[]): string => calls.map((call) => call.text).join(" ")

export const call = async (context: AskContext, name: string, args: Record<string, unknown>) => context.caller.callTool(name, args)

/** Agency questions may name a client; resolve the first name through list_visits. */
const clientIdByName = async (context: AskContext, calls: ToolCallRecord[]): Promise<string | undefined> => {
  if (context.persona !== "agency") return undefined
  const listing = await call(context, "list_visits", {})
  calls.push(listing)
  const visits = (listing.structuredContent?.visits ?? []) as Array<{ clientId: string; clientFirstName: string }>
  return visits.find((visit) => new RegExp(`\\b${visit.clientFirstName}\\b`, "i").test(context.utterance))?.clientId
}

const mentionsName = (utterance: string) => /\b(for|to|at)\s+[A-Z][a-z]+('s)?\b/.test(utterance)

const visitStatus = async (context: AskContext): Promise<BrainResult> => {
  const calls: ToolCallRecord[] = []
  const clientId = mentionsName(context.utterance) ? await clientIdByName(context, calls) : undefined
  calls.push(await call(context, "get_visit_status", withDate(context, clientId ? { clientId } : {})))
  return { calls, spoken: spokenOf(calls.slice(-1)), reasoning: "asks whether the caregiver came; get_visit_status covers every visit of the day" }
}

const lateness = async (context: AskContext): Promise<BrainResult> => {
  if (context.persona === "family") {
    const calls = [await call(context, "get_client_summary", { range: rangeOf(context.utterance) })]
    return { calls, spoken: spokenOf(calls), reasoning: "family asks about lateness; the client summary counts late arrivals from the door" }
  }
  const days = daysOf(context.utterance)
  const calls = [await call(context, "list_exceptions", withDate(context, { kind: "late_arrival", state: "any", ...(days ? { days } : {}) }))]
  return { calls, spoken: spokenOf(calls), reasoning: "agency asks who was late; late_arrival exceptions are raised from door arrival times" }
}

const exceptions = async (context: AskContext): Promise<BrainResult> => {
  if (context.persona === "family") return visitStatus(context)
  const calls = [await call(context, "list_exceptions", withDate(context))]
  return { calls, spoken: spokenOf(calls), reasoning: "asks about problems; open exceptions ranked by severity" }
}

const briefing = async (context: AskContext): Promise<BrainResult> => {
  if (context.persona === "family") return visitStatus(context)
  const calls = [await call(context, "list_visits", {}), await call(context, "list_exceptions", {})]
  return { calls, spoken: spokenOf(calls), reasoning: "morning briefing: today's visits, then open exceptions" }
}

const summary = async (context: AskContext): Promise<BrainResult> => {
  const calls: ToolCallRecord[] = []
  const clientId = await clientIdByName(context, calls)
  calls.push(await call(context, "get_client_summary", { range: rangeOf(context.utterance), ...(clientId ? { clientId } : {}) }))
  return { calls, spoken: spokenOf(calls.slice(-1)), reasoning: "asks how visits have gone; get_client_summary over the range" }
}

const schedule = async (context: AskContext): Promise<BrainResult> => {
  const calls = [await call(context, "list_visits", withDate(context))]
  return { calls, spoken: spokenOf(calls), reasoning: "asks about the schedule; list_visits for the date" }
}

const explain = async (context: AskContext): Promise<BrainResult> => {
  const visitId = context.utterance.match(/\bv_[a-z0-9_]+\b/i)?.[0]
  const calls: ToolCallRecord[] = []
  let target = visitId
  if (!target) {
    const status = await call(context, "get_visit_status", withDate(context))
    calls.push(status)
    const visits = (status.structuredContent?.visits ?? []) as Array<{ visitId: string; answer: string }>
    target = (visits.find((visit) => visit.answer !== "not_yet_due") ?? visits[0])?.visitId
  }
  if (target) calls.push(await call(context, "explain_visit", { visitId: target }))
  return { calls, spoken: spokenOf(calls.slice(-1)), reasoning: "asks to explain a visit; explain_visit returns the three-column evidence" }
}

export const FIXTURE_RULES: readonly Rule[] = [
  { intent: "explain_visit", matches: has(/\b(explain|evidence for|what happened (at|with|during))\b/i), run: explain },
  { intent: "add_visit_note", matches: has(/\b(tell the agency|let the agency know|add a note|leave a note|note that)\b/i), run: addNote },
  { intent: "acknowledge_exception", matches: has(/\b(acknowledge|resolve|clear)\b/i), run: acknowledge },
  { intent: "lateness", matches: has(/\blate\b/i), run: lateness },
  { intent: "briefing", matches: has(/\b(briefing|brief me|morning update)\b/i), run: briefing },
  { intent: "exceptions", matches: has(/\b(exceptions?|problems?|issues?|alerts?|anything wrong|needs? attention)\b/i), run: exceptions },
  { intent: "summary", matches: has(/\b(summary|reliab\w*|how (have|has|did) .*(visits?|week|month)|this (week|month))\b/i), run: summary },
  { intent: "schedule", matches: has(/\b(schedule|scheduled|who is coming|what visits|visits today|upcoming)\b/i), run: schedule },
  { intent: "visit_status", matches: has(/\b(come|came|arrive|arrived|show(ed)? up|here|visit|caregiver|status)\b/i), run: visitStatus },
]

export const HELP_TEXT =
  "I can tell you whether the caregiver came, list today's visits and exceptions, explain a visit, summarize the week, and add a note for the agency. Try: did the caregiver come today?"

/** Picks the first matching rule; returns null when nothing matches. */
export const matchRule = (context: AskContext): Rule | null =>
  FIXTURE_RULES.find((rule) => rule.matches(context.utterance, context)) ?? null
