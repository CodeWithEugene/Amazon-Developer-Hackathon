import "server-only"

import type { Client, Visit } from "@visitproof/domain"

import { formatWindow } from "@/lib/format"
import { FAMILY_EXCEPTION_TEXT } from "@/lib/labels"
import { displayNarrative, type DisplayNarrative } from "@/lib/narrative"
import {
  getAgency,
  getClient,
  getSessionClientId,
  isErased,
  listExceptions,
  listRecentVisits,
} from "@/lib/store"
import { statusLabel } from "@workspace/ui/components/status-badge"
import {
  addDaysToKey,
  formatDateKeyWeekday,
  formatLocalTimeZoned,
  localDateKey,
} from "@/lib/time"

import { chooseTodayAlert, dayHeadline, familyStatus } from "./family-summary"

export interface FamilyVisit {
  id: string
  window: string
  line: string
  status: Visit["status"]
  narrative: DisplayNarrative | null
}

export interface FamilyDay {
  dayKey: string
  dateLabel: string
  headline: string
  visits: FamilyVisit[]
}

export interface FamilyAlert {
  tone: "warning" | "destructive"
  text: string
}

export interface EarlierAlert {
  id: string
  dateLabel: string
  kindLabel: string
  text: string
}

export interface FamilyData {
  client: Pick<Client, "id" | "name" | "consent" | "ringLinkStatus">
  erased: boolean
  timeZone: string
  today: FamilyDay
  alert: FamilyAlert | null
  earlierAlerts: EarlierAlert[]
  earlierDays: FamilyDay[]
}

const HISTORY_DAYS = 14

function familyVisit(visit: Visit, tz: string, now: Date): FamilyVisit {
  const at = (iso: string) => formatLocalTimeZoned(iso, tz)
  const arrival = visit.arrival ? `arrived at ${at(visit.arrival.at)}` : "no arrival observed"
  const departure = visit.departure ? ` and left at ${at(visit.departure.at)}` : ""
  return {
    id: visit.id,
    window: formatWindow(visit.scheduledStart, visit.scheduledEnd, tz),
    line: `A caregiver ${arrival}${departure}.`,
    status: familyStatus(visit, now),
    narrative: displayNarrative(visit, tz),
  }
}

function buildDay(dayKey: string, visits: readonly Visit[], tz: string, now: Date): FamilyDay {
  const sorted = [...visits].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  return {
    dayKey,
    dateLabel: formatDateKeyWeekday(dayKey),
    headline: dayHeadline(sorted, now),
    visits: sorted.map((v) => familyVisit(v, tz, now)),
  }
}

/** The family's feed for the session persona, or null if none is bound. */
export async function loadFamily(now: Date = new Date()): Promise<FamilyData | null> {
  const clientId = await getSessionClientId()
  const client = clientId ? await getClient(clientId) : null
  if (!client) return null
  const [agency, recent, exceptions] = await Promise.all([
    getAgency(),
    listRecentVisits(HISTORY_DAYS, now),
    listExceptions(["open", "snoozed"]),
  ])
  const tz = agency.timezone
  const today = localDateKey(now, tz)
  const mine = recent.filter((v) => v.clientId === client.id)
  const dayOf = (v: Visit) => localDateKey(v.scheduledStart, tz)
  const todays = mine.filter((v) => dayOf(v) === today)
  const visitDay = new Map(mine.map((v) => [v.id, dayOf(v)]))
  const clientExceptions = exceptions.filter((e) => e.clientId === client.id)
  const choice = client.consent.exceptionAlerts
    ? chooseTodayAlert(clientExceptions, new Set(todays.map((v) => v.id)))
    : null
  const earlierDays = [1, 2, 3, 4, 5, 6]
    .map((offset) => addDaysToKey(today, -offset))
    .map((key) => buildDay(key, mine.filter((v) => dayOf(v) === key), tz, now))
    .filter((day) => day.visits.length > 0)
  return {
    client: {
      id: client.id,
      name: client.name,
      consent: client.consent,
      ringLinkStatus: client.ringLinkStatus,
    },
    erased: isErased(client),
    timeZone: tz,
    today: buildDay(today, todays, tz, now),
    alert: choice
      ? { tone: choice.tone, text: FAMILY_EXCEPTION_TEXT[choice.exception.kind] }
      : null,
    earlierAlerts: clientExceptions
      .filter((e) => {
        const day = visitDay.get(e.visitId)
        return day !== undefined && day < today
      })
      .map((e) => ({
        id: e.id,
        dateLabel: formatDateKeyWeekday(visitDay.get(e.visitId) ?? today),
        kindLabel: statusLabel(e.kind),
        text: FAMILY_EXCEPTION_TEXT[e.kind],
      })),
    earlierDays,
  }
}
