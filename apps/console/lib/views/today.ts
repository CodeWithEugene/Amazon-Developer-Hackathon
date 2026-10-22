import "server-only"

import type { Caregiver, Client, Exception, Visit } from "@visitproof/domain"

import { formatTime, formatWindow } from "@/lib/format"
import {
  agencyCanSee,
  effectiveState,
  getAgency,
  listAllVisits,
  listCaregivers,
  listClients,
  listExceptions,
} from "@/lib/store"
import {
  formatDateKeyWeekday,
  formatLocalDateTime,
  localDateKey,
  zoneAbbreviation,
} from "@/lib/time"

import { exceptionGroup, type ExceptionGroup } from "./grouping"

export interface BoardExceptionRow {
  id: string
  kind: Exception["kind"]
  group: ExceptionGroup
  visitId: string
  clientName: string
  caregiverName: string
  caregiverMobile?: string
  /** "Monday, September 14", or null when the visit record is missing. */
  visitDateLabel: string | null
  visitWindow: string | null
  snoozedUntilLabel?: string
  /** Visit start (or opened time) for newest-first ordering. */
  sortKey: string
}

export interface BoardVisitRow {
  id: string
  clientName: string
  caregiverName: string
  window: string
  arrival: string
  departure: string
  status: Visit["status"]
  /** The family withdrew sharing: show the schedule only. */
  hidden: boolean
}

export interface TodayBoardData {
  timeZone: string
  todayLabel: string
  storeEmpty: boolean
  exceptions: BoardExceptionRow[]
  visits: BoardVisitRow[]
  stats: {
    visitsToday: number
    inProgress: number
    openExceptions: number
    unlinkedClients: number
  }
}

interface Lookup {
  clients: Map<string, Client>
  caregivers: Map<string, Caregiver>
  visits: Map<string, Visit>
  timeZone: string
  today: string
  now: Date
}

function exceptionRow(exception: Exception, lookup: Lookup): BoardExceptionRow {
  const { timeZone } = lookup
  const visit = lookup.visits.get(exception.visitId)
  const caregiver = visit ? lookup.caregivers.get(visit.caregiverId) : undefined
  const visitDay = visit ? localDateKey(visit.scheduledStart, timeZone) : null
  const snoozedNow = effectiveState(exception, lookup.now) === "snoozed"
  return {
    id: exception.id,
    kind: exception.kind,
    group: exceptionGroup(visitDay, lookup.today, snoozedNow),
    visitId: exception.visitId,
    clientName: lookup.clients.get(exception.clientId)?.name ?? "Unknown client",
    caregiverName: caregiver?.name ?? "Unassigned caregiver",
    ...(caregiver?.mobile ? { caregiverMobile: caregiver.mobile } : {}),
    visitDateLabel: visitDay ? formatDateKeyWeekday(visitDay) : null,
    visitWindow: visit
      ? formatWindow(visit.scheduledStart, visit.scheduledEnd, timeZone)
      : null,
    ...(snoozedNow && exception.snoozeUntil
      ? {
          snoozedUntilLabel: `${formatLocalDateTime(exception.snoozeUntil, timeZone)} ${zoneAbbreviation(exception.snoozeUntil, timeZone)}`,
        }
      : {}),
    sortKey: visit?.scheduledStart ?? exception.openedAt,
  }
}

function visitRow(visit: Visit, lookup: Lookup): BoardVisitRow {
  const client = lookup.clients.get(visit.clientId)
  const hidden = !client || !agencyCanSee(client)
  const tz = lookup.timeZone
  return {
    id: visit.id,
    clientName: client?.name ?? "Unknown client",
    caregiverName: lookup.caregivers.get(visit.caregiverId)?.name ?? "Unassigned",
    window: formatWindow(visit.scheduledStart, visit.scheduledEnd, tz),
    arrival: hidden ? "hidden" : formatTime(visit.arrival?.at, tz),
    departure: hidden ? "hidden" : formatTime(visit.departure?.at, tz),
    status: visit.status,
    hidden,
  }
}

const newestFirst = (a: BoardExceptionRow, b: BoardExceptionRow): number =>
  b.sortKey.localeCompare(a.sortKey)

/** Everything the Today board renders, formatted in the agency zone. */
export async function loadTodayBoard(now: Date = new Date()): Promise<TodayBoardData> {
  const [agency, clients, caregivers, allVisits, exceptions] = await Promise.all([
    getAgency(),
    listClients(),
    listCaregivers(),
    listAllVisits(),
    listExceptions(["open", "snoozed"]),
  ])
  const timeZone = agency.timezone
  const today = localDateKey(now, timeZone)
  const lookup: Lookup = {
    clients: new Map(clients.map((c) => [c.id, c])),
    caregivers: new Map(caregivers.map((c) => [c.id, c])),
    visits: new Map(allVisits.map((v) => [v.id, v])),
    timeZone,
    today,
    now,
  }
  const visible = exceptions.filter((e) => {
    const client = lookup.clients.get(e.clientId)
    return client ? agencyCanSee(client) : false
  })
  const rows = visible.map((e) => exceptionRow(e, lookup))
  const todays = allVisits
    .filter((v) => localDateKey(v.scheduledStart, timeZone) === today)
    .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
    .map((v) => visitRow(v, lookup))
  return {
    timeZone,
    todayLabel: formatDateKeyWeekday(today),
    storeEmpty: clients.length === 0,
    exceptions: [...rows].sort(newestFirst),
    visits: todays,
    stats: {
      visitsToday: todays.length,
      inProgress: todays.filter((v) => v.status === "in_progress").length,
      openExceptions: rows.filter((r) => r.group !== "snoozed").length,
      unlinkedClients: clients.filter((c) => c.ringLinkStatus !== "linked").length,
    },
  }
}
