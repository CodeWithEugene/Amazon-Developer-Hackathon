/**
 * Turns a brain's terse reasoning string into one readable sentence for the
 * Ask VisitProof page. MCP tool names are shown by their readable titles
 * ("Visit Status", not "get_visit_status"); internal intent tokens such as
 * "visit_status:" and other snake_case words are never shown raw. The raw
 * names stay available only in the labeled protocol data panel.
 *
 * Fixture example:
 *   "visit_status: asks whether the caregiver came; get_visit_status covers every visit of the day"
 *   becomes "Fixture Brain chose Visit Status: it covers every visit of the day."
 */

/** The detail tab that opens first: the readable card, never the raw protocol JSON. */
export const DEFAULT_DETAIL_TAB = "visual"

/** Labels the Response Detail panel as raw protocol data. */
export const PROTOCOL_NOTE =
  "Protocol data: the raw MCP request and result exactly as exchanged, so tool names appear in code form and timestamps are in UTC. The Visual tab shows the same answer in local time."

/** Readable titles for the VisitProof MCP tools. */
export const TOOL_TITLES: Readonly<Record<string, string>> = {
  get_visit_status: "Visit Status",
  list_visits: "Visits",
  list_exceptions: "Exceptions",
  explain_visit: "Visit Evidence",
  get_client_summary: "Client Summary",
  acknowledge_exception: "Acknowledge Exception",
  add_visit_note: "Visit Note",
}

/** "get_visit_status" becomes "Visit Status"; an unknown tool is title-cased. */
export function toolTitle(name: string): string {
  const known = TOOL_TITLES[name]
  if (known) return known
  return name
    .replace(/^(?:get|list)_/, "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export interface ReasoningInput {
  readonly brainLabel: string
  readonly reasoning: string
  readonly toolNames: readonly string[]
}

const INTENT_PREFIX = /^[a-z]+(?:_[a-z]+)*:\s+/
const TRAILING_NOTE = /\s*\(([^()]*)\)\s*$/
const SNAKE_TOKEN = /\b[a-z]+(?:_[a-z]+)+\b/g
const RESTATES_QUESTION = /^(?:\w+\s+)?asks\b/
/** Words that let "chose <tool> <rest>" read as one clause. */
const LINKING_WORDS = new Set(["across", "at", "by", "for", "from", "in", "on", "over", "with"])

const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

const withPeriod = (text: string): string => (/[.!?]$/.test(text) ? text : `${text}.`)

/** "a", "a and b", or "a, b, and c". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ")
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`
}

/** Replaces tool names with their titles and other snake_case words with spaces. */
function humanizeTokens(text: string, tools: ReadonlySet<string>): string {
  return text.replace(SNAKE_TOKEN, (token) => (tools.has(token) || token in TOOL_TITLES ? toolTitle(token) : token.replaceAll("_", " ")))
}

/** The rationale clause: drops the intent token and a restated question. */
function rationaleOf(reasoning: string): string {
  const body = reasoning.replace(INTENT_PREFIX, "").trim()
  const [first = "", ...rest] = body.split("; ")
  const clauses = rest.length > 0 && RESTATES_QUESTION.test(first) ? rest : [first, ...rest]
  return clauses.join(", ").replaceAll(": ", ", ").trim()
}

/** "chose list_visits for the date" or "chose explain_visit: it returns ...". */
function choiceSentence(label: string, tools: readonly string[], rationale: string): string {
  const chosen = `${label} chose ${joinNames(tools)}`
  if (!rationale) return chosen
  const [only] = tools
  if (tools.length === 1 && only && rationale.startsWith(`${only} `)) {
    const rest = rationale.slice(only.length + 1)
    const firstWord = rest.split(" ")[0] ?? ""
    return LINKING_WORDS.has(firstWord) ? `${chosen} ${rest}` : `${chosen}: it ${rest}`
  }
  return `${chosen}: ${rationale}`
}

/** One readable sentence describing why the brain answered as it did. */
export function describeReasoning({ brainLabel, reasoning, toolNames }: ReasoningInput): string {
  const names = [...new Set(toolNames)]
  const keep = new Set(names)
  const tools = names.map(toolTitle)
  const noteMatch = TRAILING_NOTE.exec(reasoning)
  const core = noteMatch ? reasoning.slice(0, noteMatch.index) : reasoning
  const note = noteMatch?.[1] ? ` (${humanizeTokens(noteMatch[1], keep)})` : ""
  if (/\bchose\b/.test(core)) {
    return withPeriod(`${capitalize(humanizeTokens(core.trim(), keep))}${note}`)
  }
  const rationale = humanizeTokens(rationaleOf(core), keep)
  const sentence =
    tools.length > 0
      ? choiceSentence(brainLabel, tools, rationale)
      : `${brainLabel}: ${capitalize(rationale) || "No tools were called"}`
  return withPeriod(`${sentence}${note}`)
}

const TOOL_CALL_STEP = /^tools\/call\s+(\S+)$/
const TRACE_STEP_TITLES: Readonly<Record<string, string>> = {
  "tools/list": "Tool List",
  initialize: "Connect To MCP Server",
}

/**
 * Readable Trace tab label: "tools/call get_visit_status" becomes
 * "Tool Call: Visit Status", and other steps are title-cased.
 */
export function traceStepLabel(step: string): string {
  const call = TOOL_CALL_STEP.exec(step.trim())
  if (call?.[1]) return `Tool Call: ${toolTitle(call[1])}`
  const known = TRACE_STEP_TITLES[step]
  if (known) return known
  return step.split(/[\s_/]+/).filter(Boolean).map(capitalize).join(" ")
}

/** Readable Trace tab badge: the protocol flag "isError" reads "Error". */
export function traceDetailLabel(detail: string): string {
  return detail === "isError" ? "Error" : detail
}
