import "server-only"

import type { LedgerRecord, ReconciliationOutcome, Visit } from "@visitproof/domain"

import { formatTime, formatWindow } from "@/lib/format"
import {
  agencyCanSee,
  getAgency,
  listAllVisits,
  listCaregivers,
  listClients,
  listLedgerRecords,
  verifyLedgerRecords,
} from "@/lib/store"
import {
  formatLocalDate,
  formatLocalDateTime,
  localDateKey,
  zoneAbbreviation,
} from "@/lib/time"

import { formatDeltaLines, formatDeltaMinutes } from "./visit-copy"

export interface ReconRow {
  visitId: string
  clientId: string
  clientName: string
  caregiverName: string
  dayKey: string
  dateLabel: string
  window: string
  doorArrival: string
  doorDeparture: string
  clockIn: string
  clockOut: string
  /** Clock-in minus door arrival, for example "+12 min", or "None". */
  deltaIn: string
  /** Clock-out minus door departure, for example "-3 min", or "None". */
  deltaOut: string
  /** The delta cell as lines, for example ["In +12 min", "Out -3 min"] or ["No clock data"]. */
  deltaLines: readonly string[]
  outcome: ReconciliationOutcome
}

export interface LedgerRow {
  seq: number
  column: LedgerRecord["column"]
  subject: string
  at: string
  payloadHash: string
  prevHash: string
  signature: string
}

export interface LedgerChain {
  clientId: string
  clientName: string
  sharing: boolean
  verified: boolean
  records: LedgerRow[]
}

export interface ComplianceData {
  timeZone: string
  zoneLabel: string
  today: string
  storeEmpty: boolean
  hiddenClients: number
  rows: ReconRow[]
  chains: LedgerChain[]
}

const NOT_OBSERVED = "Not observed"
const NOT_RECORDED = "None"

/** One reconciliation table row; every time carries the agency zone. */
export function reconRow(
  visit: Visit,
  names: { client: string; caregiver: string },
  timeZone: string
): ReconRow {
  const r = visit.reconciliation
  return {
    visitId: visit.id,
    clientId: visit.clientId,
    clientName: names.client,
    caregiverName: names.caregiver,
    dayKey: localDateKey(visit.scheduledStart, timeZone),
    dateLabel: formatLocalDate(visit.scheduledStart, timeZone),
    window: formatWindow(visit.scheduledStart, visit.scheduledEnd, timeZone),
    doorArrival: formatTime(visit.arrival?.at, timeZone, NOT_OBSERVED),
    doorDeparture: formatTime(visit.departure?.at, timeZone, NOT_OBSERVED),
    clockIn: formatTime(r?.clockIn, timeZone, NOT_RECORDED),
    clockOut: formatTime(r?.clockOut, timeZone, NOT_RECORDED),
    deltaIn: formatDeltaMinutes(r?.deltaArrivalMin),
    deltaOut: formatDeltaMinutes(r?.deltaDepartureMin),
    deltaLines: formatDeltaLines({
      inMin: r?.deltaArrivalMin,
      outMin: r?.deltaDepartureMin,
      clockIn: r?.clockIn,
      clockOut: r?.clockOut,
      doorDeparture: visit.departure?.at,
    }),
    outcome: r?.outcome ?? "pending",
  }
}

const ledgerRow = (record: LedgerRecord, timeZone: string): LedgerRow => ({
  seq: record.seq,
  column: record.column,
  subject: record.subject,
  at: `${formatLocalDateTime(record.at, timeZone)} ${zoneAbbreviation(record.at, timeZone)}`,
  payloadHash: record.payloadHash,
  prevHash: record.prevHash,
  signature: record.signature,
})

/** Reconciliation rows for sharing clients, and every client's chain. */
export async function loadCompliance(now: Date = new Date()): Promise<ComplianceData> {
  const [agency, clients, caregivers, visits] = await Promise.all([
    getAgency(),
    listClients(),
    listCaregivers(),
    listAllVisits(),
  ])
  const timeZone = agency.timezone
  const sharing = new Map(clients.map((c) => [c.id, agencyCanSee(c)]))
  const clientName = new Map(clients.map((c) => [c.id, c.name]))
  const caregiverName = new Map(caregivers.map((c) => [c.id, c.name]))
  const rows = visits
    .filter((visit) => sharing.get(visit.clientId) === true)
    .map((visit) =>
      reconRow(
        visit,
        {
          client: clientName.get(visit.clientId) ?? "Unknown client",
          caregiver: caregiverName.get(visit.caregiverId) ?? "Unassigned",
        },
        timeZone
      )
    )
  const chains = await Promise.all(
    clients.map(async (client): Promise<LedgerChain> => {
      const allowed = agencyCanSee(client)
      const records = allowed ? await listLedgerRecords(client.id) : []
      return {
        clientId: client.id,
        clientName: client.name,
        sharing: allowed,
        verified: verifyLedgerRecords(records),
        records: records.map((r) => ledgerRow(r, timeZone)).reverse(),
      }
    })
  )
  return {
    timeZone,
    zoneLabel: zoneAbbreviation(now, timeZone),
    today: localDateKey(now, timeZone),
    storeEmpty: clients.length === 0,
    hiddenClients: clients.filter((c) => !agencyCanSee(c)).length,
    rows,
    chains,
  }
}
