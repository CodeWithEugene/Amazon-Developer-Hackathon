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
  delta: string
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

const minutes = (value: number | undefined): string =>
  value === undefined ? "none" : `${value > 0 ? "+" : ""}${Math.round(value)} min`

function reconRow(
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
    doorArrival: formatTime(visit.arrival?.at, timeZone),
    doorDeparture: formatTime(visit.departure?.at, timeZone),
    clockIn: r?.clockIn ? formatTime(r.clockIn, timeZone) : "none",
    clockOut: r?.clockOut ? formatTime(r.clockOut, timeZone) : "none",
    delta:
      r?.deltaArrivalMin === undefined && r?.deltaDepartureMin === undefined
        ? "none"
        : `In ${minutes(r?.deltaArrivalMin)}, out ${minutes(r?.deltaDepartureMin)}`,
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
