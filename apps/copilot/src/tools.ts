import { z } from "zod"
import type { Exception, Visit } from "@visitproof/domain"
import type { CopilotDataAccessor, VisitFilter } from "./accessor"

/**
 * Strands-style tool scaffold: every tool is a named, schema-validated,
 * single-intent function over the injected accessor. No LLM runs locally —
 * the intent parser (intents.ts) selects tools deterministically.
 */
export interface CopilotTool<In = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<In>
  call(accessor: CopilotDataAccessor, input: In): Promise<ToolResult>
}

export interface ToolResult {
  /** Plain-language answer, one line per item at most. */
  readonly spoken: string
  readonly data: readonly unknown[]
  /** The deterministic query that was run, for the answer's trace. */
  readonly query: string
}

const dateOrRange = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
})

function visitLine(visit: Visit): string {
  const window = `${visit.scheduledStart.slice(11, 16)} to ${visit.scheduledEnd.slice(11, 16)}`
  return `${visit.date} visit ${visit.id} for client ${visit.clientId} (${window}): ${visit.status.replace(/_/g, " ")}`
}

// ---------------------------------------------------------------------------
// list_late_visits
// ---------------------------------------------------------------------------

const lateStatuses = ["arrived_late"] as const

export const listLateVisits: CopilotTool<z.infer<typeof dateOrRange>> = {
  name: "list_late_visits",
  description:
    "Visits in a date range that arrived late or had no arrival by the grace window.",
  inputSchema: dateOrRange,
  async call(accessor, input) {
    const filter: VisitFilter = { ...input, statuses: lateStatuses }
    const visits = await accessor.listVisits(filter)
    return {
      spoken:
        visits.length === 0
          ? "No late visits in that range."
          : `${visits.length} late visit${visits.length === 1 ? "" : "s"}: ${visits.map(visitLine).join("; ")}.`,
      data: [...visits],
      query: `listVisits({ from: ${input.from}, to: ${input.to}, statuses: [arrived_late] })`,
    }
  },
}

// ---------------------------------------------------------------------------
// list_no_shows
// ---------------------------------------------------------------------------

export const listNoShows: CopilotTool<z.infer<typeof dateOrRange>> = {
  name: "list_no_shows",
  description: "Visits in a date range with no arrival by the escalation window.",
  inputSchema: dateOrRange,
  async call(accessor, input) {
    const filter: VisitFilter = { ...input, statuses: ["no_show"] }
    const visits = await accessor.listVisits(filter)
    return {
      spoken:
        visits.length === 0
          ? "No no-shows in that range."
          : `${visits.length} no-show${visits.length === 1 ? "" : "s"}: ${visits.map(visitLine).join("; ")}.`,
      data: [...visits],
      query: `listVisits({ from: ${input.from}, to: ${input.to}, statuses: [no_show] })`,
    }
  },
}

// ---------------------------------------------------------------------------
// list_missing_evidence
// ---------------------------------------------------------------------------

const evidenceGapStatuses = [
  "unobservable",
  "ambiguous",
  "departure_not_observed",
] as const
const evidenceGapOutcomes = ["missing_clock_in", "missing_both"] as const

export const listMissingEvidence: CopilotTool<z.infer<typeof dateOrRange>> = {
  name: "list_missing_evidence",
  description:
    "Visits in a date range where the door record is incomplete (unobservable, ambiguous, departure not observed) or the EVV clock-in is missing.",
  inputSchema: dateOrRange,
  async call(accessor, input) {
    const all = await accessor.listVisits({ from: input.from, to: input.to })
    const visits = all.filter(
      (v) =>
        evidenceGapStatuses.includes(v.status as (typeof evidenceGapStatuses)[number]) ||
        (v.reconciliation !== undefined &&
          evidenceGapOutcomes.includes(
            v.reconciliation.outcome as (typeof evidenceGapOutcomes)[number],
          )),
    )
    return {
      spoken:
        visits.length === 0
          ? "Every visit in that range has a complete evidence record."
          : `${visits.length} visit${visits.length === 1 ? "" : "s"} missing evidence: ${visits.map(visitLine).join("; ")}.`,
      data: [...visits],
      query: `listVisits({ from: ${input.from}, to: ${input.to} }) filtered to statuses [${evidenceGapStatuses.join(", ")}] or reconciliation outcomes [${evidenceGapOutcomes.join(", ")}]`,
    }
  },
}

// ---------------------------------------------------------------------------
// explain_exception
// ---------------------------------------------------------------------------

const explainInput = z.object({
  exceptionId: z.string().min(1).optional(),
  /** When no id is given, explain the most recent open exception. */
  latestOpen: z.boolean().default(false),
})

export const explainException: CopilotTool<z.infer<typeof explainInput>> = {
  name: "explain_exception",
  description:
    "Explain one exception in plain language: what kind, what state, and which visit it belongs to. With no id, explains the most recent open exception.",
  inputSchema: explainInput,
  async call(accessor, input) {
    let exception: Exception | undefined
    if (input.exceptionId !== undefined) {
      exception = await accessor.getException(input.exceptionId)
    } else {
      const open = await accessor.listExceptions({ state: "open" })
      exception = [...open].sort((a, b) =>
        b.openedAt.localeCompare(a.openedAt),
      )[0]
    }
    if (exception === undefined) {
      return {
        spoken: "No matching exception found.",
        data: [],
        query:
          input.exceptionId !== undefined
            ? `getException(${input.exceptionId})`
            : "listExceptions({ state: open }) sorted by openedAt desc, first",
      }
    }
    const visit = await accessor.getVisit(exception.visitId)
    const kind = exception.kind.replace(/_/g, " ")
    const parts = [
      `Exception ${exception.id} (${kind}) is ${exception.state}, opened ${exception.openedAt} for client ${exception.clientId}.`,
    ]
    if (visit !== undefined) {
      parts.push(
        `Visit ${visit.id} was scheduled ${visit.scheduledStart} to ${visit.scheduledEnd} and is currently ${visit.status.replace(/_/g, " ")}.`,
      )
      if (visit.observability.reasons.length > 0) {
        parts.push(
          `Observability reasons: ${visit.observability.reasons.join(", ")}.`,
        )
      }
    }
    return {
      spoken: parts.join(" "),
      data: [{ exception, visit }],
      query:
        input.exceptionId !== undefined
          ? `getException(${input.exceptionId}) then getVisit(${exception.visitId})`
          : `listExceptions({ state: open }) latest, then getVisit(${exception.visitId})`,
    }
  },
}

export const COPILOT_TOOLS: readonly CopilotTool<never>[] = [
  listLateVisits,
  listNoShows,
  listMissingEvidence,
  explainException,
] as unknown as readonly CopilotTool<never>[]

export function findTool(name: string): CopilotTool<never> | undefined {
  return COPILOT_TOOLS.find((tool) => tool.name === name)
}
