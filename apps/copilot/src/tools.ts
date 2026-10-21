import { z } from "zod"
import type { Exception, Visit } from "@visitproof/domain"

import type { CopilotDataAccessor } from "./accessor"
import { DEFAULT_TIME_ZONE, formatLocalDate, localDateKey, spokenTime } from "./time"

/**
 * Ops copilot tools: named, schema-validated, single-intent functions over
 * the injected accessor. The deterministic intent parser (intents.ts)
 * selects them; answers name at most five items with agency-local times.
 */
export interface ToolEnv {
  /** Agency time zone for every rendered time (contract C1). */
  readonly timeZone: string
  /** Minutes after the scheduled start before an arrival counts as late. */
  readonly graceMin: number
}

export const DEFAULT_TOOL_ENV: ToolEnv = { timeZone: DEFAULT_TIME_ZONE, graceMin: 15 }

export interface CopilotTool<In = unknown> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<In>
  call(accessor: CopilotDataAccessor, input: In, env?: ToolEnv): Promise<ToolResult>
}

export interface ToolResult {
  /** Plain-language answer naming at most five items. */
  readonly spoken: string
  /** Every matching row, unbounded. */
  readonly data: readonly unknown[]
  /** The deterministic query that was run, for the answer's trace. */
  readonly query: string
}

export const MAX_SPOKEN_ITEMS = 5

const dateOrRange = z.object({ from: z.iso.date(), to: z.iso.date() })

const firstName = (name: string) => name.split(" ")[0] ?? name

const clientLabel = async (accessor: CopilotDataAccessor, clientId: string): Promise<string> => {
  const client = accessor.getClient ? await accessor.getClient(clientId) : undefined
  return client ? firstName(client.name) : "a client"
}

const dayAndTime = (iso: string, env: ToolEnv): string =>
  `${formatLocalDate(localDateKey(iso, env.timeZone)).split(",")[0]} ${spokenTime(iso, env.timeZone)}`

const minutesLate = (visit: Visit): number =>
  visit.arrival ? Math.round((Date.parse(visit.arrival.at) - Date.parse(visit.scheduledStart)) / 60_000) : 0

/** Door arrival later than the scheduled start plus grace, whatever the terminal status. */
export const isLateArrival = (visit: Visit, graceMin: number): boolean =>
  Boolean(visit.arrival) && visit.observability.state !== "unobservable" && minutesLate(visit) > graceMin

const visitLines = async (
  accessor: CopilotDataAccessor,
  visits: readonly Visit[],
  env: ToolEnv,
  detail: (visit: Visit) => string,
): Promise<string[]> =>
  Promise.all(
    visits
      .slice(0, MAX_SPOKEN_ITEMS)
      .map(async (visit) => `${await clientLabel(accessor, visit.clientId)}, ${dayAndTime(visit.scheduledStart, env)}, ${detail(visit)}`),
  )

/** "3 late arrivals: a; b; c." naming at most five, with "and N more". */
const spokenFor = (count: number, one: string, many: string, named: readonly string[]): string => {
  const rest = count - named.length
  const list = rest > 0 ? `${named.join("; ")}; and ${rest} more` : named.join("; ")
  return `${count} ${count === 1 ? one : many}: ${list}.`
}

// ---------------------------------------------------------------------------
// list_late_visits
// ---------------------------------------------------------------------------

export const listLateVisits: CopilotTool<z.infer<typeof dateOrRange>> = {
  name: "list_late_visits",
  description: "Visits in a date range whose door arrival came after the scheduled start plus the grace window.",
  inputSchema: dateOrRange,
  async call(accessor, input, env = DEFAULT_TOOL_ENV) {
    const visits = (await accessor.listVisits(input)).filter((visit) => isLateArrival(visit, env.graceMin))
    const lines = await visitLines(accessor, visits, env, (visit) => `${minutesLate(visit)} minutes late`)
    return {
      spoken: visits.length === 0 ? "No late arrivals in that range." : spokenFor(visits.length, "late arrival", "late arrivals", lines),
      data: [...visits],
      query: `listVisits({ from: ${input.from}, to: ${input.to} }) filtered to arrival later than scheduled start + ${env.graceMin} min`,
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
  async call(accessor, input, env = DEFAULT_TOOL_ENV) {
    const visits = await accessor.listVisits({ ...input, statuses: ["no_show"] })
    const lines = await visitLines(accessor, visits, env, () => "no one at the door")
    return {
      spoken: visits.length === 0 ? "No no-shows in that range." : spokenFor(visits.length, "no-show", "no-shows", lines),
      data: [...visits],
      query: `listVisits({ from: ${input.from}, to: ${input.to}, statuses: [no_show] })`,
    }
  },
}

// ---------------------------------------------------------------------------
// list_missing_evidence
// ---------------------------------------------------------------------------

const evidenceGapStatuses = ["unobservable", "ambiguous", "departure_not_observed"] as const
const evidenceGapOutcomes = ["missing_clock_in", "missing_both"] as const

const gapOf = (visit: Visit): string | null => {
  if ((evidenceGapStatuses as readonly string[]).includes(visit.status)) return visit.status.replace(/_/g, " ")
  const outcome = visit.reconciliation?.outcome
  return outcome && (evidenceGapOutcomes as readonly string[]).includes(outcome) ? outcome.replace(/_/g, " ") : null
}

export const listMissingEvidence: CopilotTool<z.infer<typeof dateOrRange>> = {
  name: "list_missing_evidence",
  description:
    "Visits in a date range where the door record is incomplete (unobservable, ambiguous, departure not observed) or the EVV clock-in is missing.",
  inputSchema: dateOrRange,
  async call(accessor, input, env = DEFAULT_TOOL_ENV) {
    const visits = (await accessor.listVisits(input)).filter((visit) => gapOf(visit) !== null)
    const lines = await visitLines(accessor, visits, env, (visit) => gapOf(visit) ?? "")
    return {
      spoken: visits.length === 0 ? "Every visit in that range has a complete evidence record." : spokenFor(visits.length, "visit missing evidence", "visits missing evidence", lines),
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

const findException = async (accessor: CopilotDataAccessor, exceptionId?: string): Promise<Exception | undefined> => {
  if (exceptionId !== undefined) return accessor.getException(exceptionId)
  const open = await accessor.listExceptions({ state: "open" })
  return [...open].sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0]
}

export const explainException: CopilotTool<z.infer<typeof explainInput>> = {
  name: "explain_exception",
  description:
    "Explain one exception in plain language: what kind, what state, and which visit it belongs to. With no id, explains the most recent open exception.",
  inputSchema: explainInput,
  async call(accessor, input, env = DEFAULT_TOOL_ENV) {
    const exception = await findException(accessor, input.exceptionId)
    const baseQuery = input.exceptionId !== undefined ? `getException(${input.exceptionId})` : "listExceptions({ state: open }) sorted by openedAt desc, first"
    if (exception === undefined) return { spoken: "No matching exception found.", data: [], query: baseQuery }
    const visit = await accessor.getVisit(exception.visitId)
    const who = await clientLabel(accessor, exception.clientId)
    const parts = [`The ${exception.kind.replace(/_/g, " ")} exception for ${who} is ${exception.state}, opened ${dayAndTime(exception.openedAt, env)}.`]
    if (visit !== undefined) {
      parts.push(`The visit was scheduled for ${dayAndTime(visit.scheduledStart, env)} and is ${visit.status.replace(/_/g, " ")}.`)
      if (visit.arrival) parts.push(`Someone arrived at the door at ${spokenTime(visit.arrival.at, env.timeZone)}.`)
      if (visit.observability.reasons.length > 0) parts.push(`It could not be fully observed: ${visit.observability.reasons.join(", ").replace(/_/g, " ")}.`)
    }
    return {
      spoken: parts.join(" "),
      data: [{ exception, visit }],
      query: `${baseQuery} then getVisit(${exception.visitId})`,
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

