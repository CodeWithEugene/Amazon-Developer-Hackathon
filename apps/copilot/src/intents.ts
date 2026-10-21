import { addDays, DEFAULT_TIME_ZONE, localDateKey } from "./time"

/**
 * Deterministic intent parser: template and rule based, no LLM. Maps an
 * operator question to a tool selection plus extracted arguments, and
 * explains the decision so the answer can narrate it.
 */

export interface ParsedIntent {
  readonly intent: string
  readonly toolName: string
  readonly args: Record<string, unknown>
  /** Human-readable trace of why this intent was chosen. */
  readonly reasoning: string
}

export interface DateRange {
  readonly from: string
  readonly to: string
}

export type Now = () => Date

/**
 * `today`, `yesterday`, `this week` (Monday to today), `this month`, or an
 * explicit date. Dates are calendar dates in the agency time zone (C1).
 */
export function resolveRange(question: string, now: Now, timeZone: string = DEFAULT_TIME_ZONE): DateRange {
  const todayStr = localDateKey(now(), timeZone)
  if (/\bthis week\b/i.test(question)) {
    const day = new Date(`${todayStr}T12:00:00Z`).getUTCDay() // 0 Sunday
    return { from: addDays(todayStr, -((day + 6) % 7)), to: todayStr }
  }
  if (/\bthis month\b/i.test(question)) {
    return { from: todayStr.slice(0, 8) + "01", to: todayStr }
  }
  if (/\byesterday\b/i.test(question)) {
    const yesterday = addDays(todayStr, -1)
    return { from: yesterday, to: yesterday }
  }
  const explicit = question.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (explicit !== null) {
    return { from: explicit[1] ?? todayStr, to: explicit[1] ?? todayStr }
  }
  return { from: todayStr, to: todayStr }
}

interface Rule {
  readonly intent: string
  readonly toolName: string
  readonly patterns: readonly RegExp[]
  readonly buildArgs: (question: string, range: DateRange) => Record<string, unknown>
  readonly describe: (range: DateRange) => string
}

const rangeArgs = (_q: string, r: DateRange) => ({ from: r.from, to: r.to })

// Order matters: the first matching rule wins. `explain_exception` goes
// first because a minted exception id (`V-late#late_no_arrival`) contains
// words like "late" that would otherwise capture the question.
const RULES: readonly Rule[] = [
  {
    intent: "explain_exception",
    toolName: "explain_exception",
    patterns: [
      /\bexplain\b.*\bexception\b/i,
      /\bwhat happened with\b/i,
      /\bwhy\b.*\b(exception|alert|flag)\b/i,
    ],
    buildArgs: (question) => {
      // Exception ids are minted by buildException as `${visitId}#${kind}`
      // (e.g. "v_okoro_03#late_arrival"), never an "EXC-" serial.
      const id = question.match(/[\w-]+#[\w-]+/)
      return id !== null
        ? { exceptionId: id[0] }
        : { latestOpen: true }
    },
    describe: () =>
      "question asks to explain an exception; loading the exception and its visit",
  },
  {
    intent: "who_was_late",
    toolName: "list_late_visits",
    patterns: [
      /\b(who|which|any(one|body)?)\b.*\blate\b/i,
      /\blate\b/i,
    ],
    buildArgs: rangeArgs,
    describe: (r) =>
      `question mentions "late"; querying visits whose door arrival came after the grace window between ${r.from} and ${r.to}`,
  },
  {
    intent: "no_shows",
    toolName: "list_no_shows",
    patterns: [/\bno[- ]?shows?\b/i],
    buildArgs: rangeArgs,
    describe: (r) =>
      `question mentions no-shows; querying visits marked no_show between ${r.from} and ${r.to}`,
  },
  {
    intent: "missing_evidence",
    toolName: "list_missing_evidence",
    patterns: [
      /\bmissing (evidence|clock[- ]?ins?|door records?)\b/i,
      /\b(unobservable|ambiguous|incomplete)\b.*\bvisits?\b/i,
    ],
    buildArgs: rangeArgs,
    describe: (r) =>
      `question mentions evidence gaps; querying incomplete door records or missing clock-ins between ${r.from} and ${r.to}`,
  },
]

export function parseIntent(question: string, now: Now, timeZone: string = DEFAULT_TIME_ZONE): ParsedIntent {
  const range = resolveRange(question, now, timeZone)
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(question))) {
      return {
        intent: rule.intent,
        toolName: rule.toolName,
        args: rule.buildArgs(question, range),
        reasoning: rule.describe(range),
      }
    }
  }
  return {
    intent: "unknown",
    toolName: "",
    args: {},
    reasoning:
      "no intent template matched; the copilot only answers late arrivals, no-shows, missing evidence, and exception explanations",
  }
}
