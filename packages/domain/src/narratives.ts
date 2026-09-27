/**
 * Plainly-worded visit narratives (docs/build.md Section 6).
 * The template path is fully local and deterministic; Bedrock is prod-only
 * and layered on top by the narrative-writer handler.
 */
import type { Narrative, Reconciliation, Visit } from "./types"

const MIN = 60_000

export interface NarrativeInput {
  visit: Visit
  caregiverName?: string
  now: Date
}

function timeOf(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(11, 16)
}

function minuteDiff(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / MIN)
}

function deltaPhrase(label: string, deltaMin: number): string {
  const plural = Math.abs(deltaMin) === 1 ? "minute" : "minutes"
  return deltaMin === 0
    ? `on time (${timeOf(label)})`
    : `${Math.abs(deltaMin)} ${plural} ${deltaMin > 0 ? "after" : "before"} the scheduled time (${timeOf(label)})`
}

/** Deterministic template narrative; no identity or health language. */
export function buildNarrative(input: NarrativeInput): Narrative {
  const { visit, now } = input
  const parts: string[] = []
  if (visit.arrival) {
    const delta = minuteDiff(visit.scheduledStart, visit.arrival.at)
    parts.push(`A caregiver arrived at ${timeOf(visit.arrival.at)}, ${deltaPhrase(visit.scheduledStart, delta)}.`)
  } else if (visit.status === "no_show") {
    parts.push(`No caregiver arrival was observed by the end of the escalation window.`)
  } else if (visit.observability.state === "unobservable") {
    parts.push(`The door could not be observed for this visit.`)
  } else {
    parts.push(`No caregiver arrival has been observed yet.`)
  }
  if (visit.departure) {
    const delta = minuteDiff(visit.scheduledEnd, visit.departure.at)
    parts.push(`They left at ${timeOf(visit.departure.at)}, ${deltaPhrase(visit.scheduledEnd, delta)}.`)
  } else if (visit.arrival && visit.status === "departure_not_observed") {
    parts.push(`No departure was observed by the end of the visit window.`)
  }
  parts.push(reconciliationPhrase(visit.reconciliation))
  if (visit.status === "ambiguous") {
    parts.push(`More than one possible arrival was detected, so a person must review this visit.`)
  }
  return {
    text: parts.filter(Boolean).join(" "),
    provenance: "template",
    generatedAt: now.toISOString(),
  }
}

function reconciliationPhrase(reconciliation: Reconciliation | undefined): string {
  if (!reconciliation) return ""
  switch (reconciliation.outcome) {
    case "corroborated":
      return `The door record matches the caregiver's clock-in.`
    case "corroborated_with_variance":
      return `The door record and the caregiver's clock-in differ by more than ten minutes.`
    case "contradicted":
      return `The door record does not match the caregiver's clock-in.`
    case "missing_clock_in":
      return `No caregiver clock-in has been matched to this visit.`
    case "missing_door":
      return `No door record was observed for the clocked-in visit.`
    case "missing_both":
      return `Neither a door record nor a clock-in exists for this visit.`
    case "unobservable":
      return `The door could not be observed, so the clock-in cannot be checked.`
    default:
      return ""
  }
}

export interface NarrativeRules {
  mustContainTimes: boolean
  under60Words: boolean
  noOtherNames: boolean
}

/** Validate narrative output rules; used for both template and model text. */
export function validateNarrative(text: string, visit: Visit, caregiverName?: string): NarrativeRules {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const timesPresent =
    !visit.arrival || new RegExp(timeOf(visit.arrival.at).replace(":", "\\:")).test(text)
  // The caregiver's own name is allowed; match it per-word ("Maria Santos"
  // allows both "Maria" and "Santos").
  const allowed = new Set((caregiverName ?? "").split(/\s+/).filter(Boolean))
  const noOtherNames = words.every((word, index) => {
    const candidate = word.replace(/^[("']+/, "").replace(/[).,"':;!?]+$/, "")
    if (!/^[A-Z][a-z]+$/.test(candidate)) return true
    if (allowed.has(candidate)) return true
    // A capitalized word that opens a sentence is grammar, not a name.
    if (index === 0) return true
    return /[.!?]["')]*$/.test(words[index - 1] ?? "")
  })
  return {
    mustContainTimes: timesPresent,
    under60Words: words.length < 60,
    noOtherNames,
  }
}
