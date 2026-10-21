/**
 * Evidence packs (docs/build.md Sections 4 and 6). The Open EVV style export
 * lives in ./openevv and ledger signing in ./ledger; both are re-exported
 * here for a single import surface.
 */
import { canonicalHash } from "./ledger"
import { reconcile } from "./reconcile"
import type { Client, DoorEvent, EVVRecord, Exception, Tolerances, Visit } from "./types"

export * from "./ledger"
export * from "./openevv"

export interface EvidenceTimelineEntry {
  at: string
  column: "observed" | "reported" | "resolved"
  label: string
}

export interface EvidenceVisitSummary {
  visitId: string
  date: string
  scheduledStart: string
  scheduledEnd: string
  status: Visit["status"]
  arrival?: Visit["arrival"]
  departure?: Visit["departure"]
  reconciliation?: Visit["reconciliation"]
  narrative?: string
  exceptionKinds: string[]
}

export interface EvidencePack {
  clientId: string
  clientName: string
  agencyId: string
  generatedAt: string
  rangeStart: string
  rangeEnd: string
  visits: EvidenceVisitSummary[]
  timeline: EvidenceTimelineEntry[]
  payloadHash: string
}

export interface EvidencePackInput {
  client: Client
  visits: readonly Visit[]
  events: readonly DoorEvent[]
  evvRecords: readonly EVVRecord[]
  exceptions: readonly Exception[]
  tolerances: Tolerances
  now: Date
}

export function buildEvidencePack(input: EvidencePackInput): EvidencePack {
  const { client, now, tolerances } = input
  const range = input.visits.map((visit) => Date.parse(visit.scheduledStart))
  const rangeStart = range.length > 0 ? new Date(Math.min(...range)).toISOString() : now.toISOString()
  const rangeEnd = range.length > 0 ? new Date(Math.max(...input.visits.map((v) => Date.parse(v.scheduledEnd)))).toISOString() : now.toISOString()

  const visits: EvidenceVisitSummary[] = input.visits.map((visit) => {
    const computed = reconcile({
      visit,
      evvRecords: input.evvRecords,
      tolerances,
      events: input.events,
    })
    return {
      visitId: visit.id,
      date: visit.date,
      scheduledStart: visit.scheduledStart,
      scheduledEnd: visit.scheduledEnd,
      status: visit.status,
      arrival: visit.arrival,
      departure: visit.departure,
      reconciliation:
        visit.reconciliation ??
        (computed.outcome === "pending" ? undefined : computed),
      narrative: visit.narrative?.text,
      exceptionKinds: input.exceptions
        .filter((exception) => exception.visitId === visit.id)
        .map((exception) => exception.kind),
    }
  })

  const timeline: EvidenceTimelineEntry[] = buildTimeline(input)

  const pack: Omit<EvidencePack, "payloadHash"> = {
    clientId: client.id,
    clientName: client.name,
    agencyId: client.agencyId,
    generatedAt: now.toISOString(),
    rangeStart,
    rangeEnd,
    visits,
    timeline,
  }
  return { ...pack, payloadHash: canonicalHash(pack) }
}

function buildTimeline(input: EvidencePackInput): EvidenceTimelineEntry[] {
  const entries: EvidenceTimelineEntry[] = []
  for (const event of input.events) {
    entries.push({
      at: event.at,
      column: "observed",
      label: `${event.type}${event.subType ? ` (${event.subType})` : ""} via ${event.provenance}`,
    })
  }
  for (const evv of input.evvRecords) {
    entries.push({ at: evv.clockIn, column: "reported", label: `clock-in (${evv.source})` })
    if (evv.clockOut) {
      entries.push({ at: evv.clockOut, column: "reported", label: `clock-out (${evv.source})` })
    }
  }
  for (const exception of input.exceptions) {
    entries.push({ at: exception.openedAt, column: "resolved", label: `exception ${exception.kind} opened` })
    if (exception.resolution) {
      entries.push({
        at: exception.resolution.at,
        column: "resolved",
        label: `exception ${exception.kind} resolved: ${exception.resolution.reason}`,
      })
    }
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}
