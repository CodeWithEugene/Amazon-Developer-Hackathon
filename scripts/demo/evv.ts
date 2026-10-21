/**
 * EVV clock records for the demo, generated from the emulator's ground
 * truth (what the caregiver actually did), never from the engine's output:
 * normal clock-ins land within a few minutes of the true arrival with a GPS
 * fix near the home, the 6 contradicted ones claim presence 38 to 50
 * minutes early from about 2 to 3 km away, and the 8 missing ones have no
 * row. The rows are written as the vendor CSV a customer would upload and
 * imported through the domain parser (parseEvvCsv).
 */
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

import type { VisitProofRepository } from "@visitproof/db"
import {
  formatEvvCsv,
  parseEvvCsv,
  type EVVRecord,
  type EvvCsvRow,
} from "@visitproof/domain"
import type { EvidenceLedger } from "@visitproof/engine"
import type { TwoWeeksVisitPlan } from "@visitproof/ring-partner-sdk"

import { AGENCY_ID, TIME_ZONE } from "./config"
import { CAREGIVERS, CLIENTS, infoFor } from "./fixtures"
import { DemoError } from "./log"

export const EVV_FIXTURE = "evv-import.csv"
const METERS_PER_DEGREE_LAT = 111_320

/** Two deterministic numbers in [0, 1) per key. */
function unitPair(key: string): readonly [number, number] {
  const digest = createHash("sha256").update(key).digest()
  return [digest.readUInt32BE(0) / 2 ** 32, digest.readUInt32BE(4) / 2 ** 32]
}

/** A GPS fix `meters` from home in a direction derived from `key`, to 5 decimals (about 1 m). */
export function gpsNear(
  home: { lat: number; lng: number },
  meters: number,
  key: string
): { lat: number; lng: number } {
  const [, turn] = unitPair(`${key}:bearing`)
  const bearing = turn * 2 * Math.PI
  const dLat = (meters * Math.cos(bearing)) / METERS_PER_DEGREE_LAT
  const dLng =
    (meters * Math.sin(bearing)) /
    (METERS_PER_DEGREE_LAT * Math.cos((home.lat * Math.PI) / 180))
  const round = (value: number) => Math.round(value * 100_000) / 100_000
  return { lat: round(home.lat + dLat), lng: round(home.lng + dLng) }
}

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** "2026-10-01 08:03" in the agency time zone (the vendor export format). */
export function localWallTime(epochMs: number): string {
  const parts = Object.fromEntries(
    wallClock
      .formatToParts(new Date(epochMs))
      .map((part) => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

const distanceFor = (plan: TwoWeeksVisitPlan, key: string): number => {
  const [spread] = unitPair(`${key}:distance`)
  return plan.evv.behavior === "contradicted"
    ? 1_800 + spread * 1_400
    : 5 + spread * 55
}

/** One vendor row per planned clock-in (normal or contradicted). */
export function evvRows(plans: readonly TwoWeeksVisitPlan[]): EvvCsvRow[] {
  return plans.flatMap((plan, index) => {
    if (plan.evv.clockInAt === null) return []
    const key = `${plan.clientId}:${index}`
    const client = infoFor(CLIENTS, plan.clientId, "client")
    const gps = gpsNear(client.home, distanceFor(plan, key), key)
    return [
      {
        RecordId: `evv_${createHash("sha256").update(key).digest("hex").slice(0, 12)}`,
        ClientId: plan.clientId,
        CaregiverEvvId: infoFor(CAREGIVERS, plan.caregiver, "caregiver")
          .evvEmployeeId,
        ServiceCode: client.serviceCode,
        ClockIn: localWallTime(plan.evv.clockInAt),
        ...(plan.evv.clockOutAt === null
          ? {}
          : { ClockOut: localWallTime(plan.evv.clockOutAt) }),
        VerificationMethod: "mobile GPS",
        Latitude: gps.lat,
        Longitude: gps.lng,
      },
    ]
  })
}

export async function writeEvvFixture(
  storeDir: string,
  plans: readonly TwoWeeksVisitPlan[]
): Promise<string> {
  const path = join(storeDir, EVV_FIXTURE)
  await writeFile(path, formatEvvCsv(evvRows(plans)))
  return path
}

/** Imports the CSV through the domain parser; every row must parse. */
export async function importEvvCsv(
  repo: VisitProofRepository,
  ledger: EvidenceLedger,
  path: string,
  importedAt: Date
): Promise<EVVRecord[]> {
  const { records, errors } = parseEvvCsv(await readFile(path, "utf8"), {
    agencyId: AGENCY_ID,
    now: importedAt,
    timeZone: TIME_ZONE,
  })
  if (errors.length > 0) {
    throw new DemoError(
      `the EVV fixture has invalid rows: ${errors.map((e) => `line ${e.line}: ${e.message}`).join("; ")}`
    )
  }
  for (const record of records) {
    await repo.evvRecords.put(record)
    await ledger.append({
      clientId: record.clientId,
      column: "reported",
      subject: record.id,
      payload: {
        kind: "evv_clock_record",
        source: record.source,
        clockIn: record.clockIn,
        clockOut: record.clockOut ?? null,
      },
      at: importedAt,
    })
  }
  return records
}
