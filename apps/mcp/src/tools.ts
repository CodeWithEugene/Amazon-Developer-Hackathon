/**
 * VisitProof MCP tool surface (docs/build.md Section 8.1). Read tools:
 * get_visit_status, list_visits, list_exceptions, explain_visit,
 * get_client_summary. Write tools with confirmation: acknowledge_exception,
 * add_visit_note. Resource templates and the morning_briefing prompt live in
 * ./tools/resources.
 */
export { ToolError, type ElicitOutcome, type ToolContext } from "./tools/context"
export { getVisitStatus, type VisitStatusItem, type VisitStatusResult } from "./tools/visit-status"
export { listVisits, type ListVisitsResult, type VisitListItem } from "./tools/visits"
export { listExceptions, type ExceptionSummary, type ExceptionsResult, type ListExceptionsArgs } from "./tools/exceptions"
export { explainVisit, type EvidenceEntry, type VisitEvidenceResult } from "./tools/explain"
export { getClientSummary, type ClientSummaryResult, type SummaryRange } from "./tools/summary"
export { acknowledgeException, addVisitNote, type WriteResult } from "./tools/writes"
export { registerTools, withVoice } from "./tools/register"
export { registerPrompts, registerResources } from "./tools/resources"
export { MAX_SPOKEN_ITEMS } from "./tools/format"

export const MCP_INSTRUCTIONS = `You are the VisitProof voice assistant for home care visits.
Answer with the spoken field of tool results. Keep answers under 40 words and name at most five items.
Say times exactly as the tools give them, in the agency time zone (for example 8:04 AM ET).
The door only sees that someone arrived: never say who the door saw. Name a caregiver only when the tool says they clocked in.
Never speculate: if a visit could not be observed or a tool returns unknown, say so plainly.
Before acknowledge_exception or add_visit_note, ask the user to confirm and pass confirmed true only after they say yes.
Never mention medical details or health conditions.`
