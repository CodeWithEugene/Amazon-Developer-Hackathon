import { ledgerRecordHash, ledgerSigningHash, type LedgerRecord } from "@visitproof/domain"

import { addDaysToKey, localDateKey } from "@/lib/time"

/**
 * Moves a recorded demo store onto a new calendar week. The hosted demo
 * ships one store produced by `pnpm demo`; without this its "today" would
 * drift into the past. Instants keep their agency-local wall clock time
 * (so a 9:00 AM ET visit stays 9:00 AM ET across a DST change), calendar
 * date keys move by whole days, and the demo ledger is re-signed because
 * its signatures cover the record time.
 */

const DAY_MS = 86_400_000
const DATE_OR_INSTANT = /(?<![\d-])(\d{4}-\d{2}-\d{2})(T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?(?![\d:])/g
const EPOCH_MS = /("timestampMs":\s*|EVENT#)(\d{13})/g

/** Offset of the zone from UTC at an instant, in milliseconds. */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMs))
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? 0)
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  return wall - Math.floor(epochMs / 1000) * 1000
}

/** Shifts an instant by whole local days, keeping its wall clock time in the zone. */
export function shiftInstant(epochMs: number, days: number, timeZone: string): number {
  const wall = epochMs + zoneOffsetMs(epochMs, timeZone) + days * DAY_MS
  const guess = wall - zoneOffsetMs(epochMs, timeZone)
  return wall - zoneOffsetMs(guess, timeZone)
}

const shiftIso = (iso: string, days: number, timeZone: string): string => {
  const shifted = new Date(shiftInstant(Date.parse(iso), days, timeZone)).toISOString()
  return iso.includes(".") ? shifted : shifted.replace(/\.\d{3}Z$/, "Z")
}

/** Rewrites every date key, ISO instant, and event epoch in a JSON document's text. */
export function rebaseText(text: string, days: number, timeZone: string): string {
  if (days === 0) return text
  return text
    .replace(DATE_OR_INSTANT, (match: string, date: string, time: string | undefined) =>
      time ? shiftIso(match, days, timeZone) : addDaysToKey(date, days)
    )
    .replace(EPOCH_MS, (_match, prefix: string, ms: string) => `${prefix}${shiftInstant(Number(ms), days, timeZone)}`)
}

/** Whole days from the recorded seed day to today in the agency zone. */
export function daysSinceSeed(seedDay: string, now: Date, timeZone: string): number {
  const today = localDateKey(now, timeZone)
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${seedDay}T12:00:00Z`)) / DAY_MS)
}

/** Re-links and re-signs each client's chain after its times moved. */
export function resignLedger(records: readonly LedgerRecord[], sign: (digest: string) => string): LedgerRecord[] {
  const ordered = [...records].sort((a, b) => a.clientId.localeCompare(b.clientId) || a.seq - b.seq)
  const signed: LedgerRecord[] = []
  for (const record of ordered) {
    const prev = signed.at(-1)
    const prevHash = prev && prev.clientId === record.clientId ? ledgerRecordHash(prev) : "genesis"
    const relinked = { ...record, prevHash }
    signed.push({ ...relinked, signature: sign(ledgerSigningHash(relinked)) })
  }
  return signed
}
