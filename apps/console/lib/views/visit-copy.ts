import { formatTime } from "@/lib/format"

/**
 * Plain-language sentences for door and clock-in times. Every time carries
 * the agency zone (for example "8:08 AM ET"), and a missing time is said in
 * words rather than as a bare "none" or "to not observed".
 */

/** "Door: arrived 8:08 AM ET, left 10:02 AM ET." and its missing forms. */
export function doorSummary(
  arrivalIso: string | undefined,
  departureIso: string | undefined,
  timeZone: string
): string {
  if (!arrivalIso && !departureIso) {
    return "Door: no arrival or departure observed."
  }
  const arrival = arrivalIso
    ? `arrived ${formatTime(arrivalIso, timeZone)}`
    : "arrival not observed"
  const departure = departureIso
    ? `left ${formatTime(departureIso, timeZone)}`
    : "departure not observed"
  return `Door: ${arrival}, ${departure}.`
}

/** "Clock-in: 8:10 AM ET." or "Clock-in: none recorded." */
export function clockInSummary(
  clockInIso: string | undefined,
  timeZone: string
): string {
  return clockInIso
    ? `Clock-in: ${formatTime(clockInIso, timeZone)}.`
    : "Clock-in: none recorded."
}

/** A signed minute difference for a table cell, for example "+12 min". */
export function formatDeltaMinutes(value: number | undefined): string {
  if (value === undefined) return "None"
  const rounded = Math.round(value)
  return `${rounded > 0 ? "+" : ""}${rounded} min`
}

/** What the delta cell needs to know: the deltas, and which times exist. */
export interface DeltaCell {
  readonly inMin?: number
  readonly outMin?: number
  readonly clockIn?: string
  readonly clockOut?: string
  readonly doorDeparture?: string
}

const deltaOutLine = ({ inMin, outMin, clockOut, doorDeparture }: DeltaCell): string => {
  if (outMin !== undefined) return `Out ${formatDeltaMinutes(outMin)}`
  if (!clockOut) return "Out: no clock-out"
  if (!doorDeparture) return "Out: no door departure to compare"
  // Departure is only compared once the arrival matched a door event.
  return inMin === undefined ? "Out: not compared without a door arrival" : "Out: no door departure to compare"
}

/**
 * The delta cell as readable lines: "In +12 min" and "Out -2 min", or a
 * line naming the side that is missing. A clock time with no door time to
 * compare says so; "No clock data" is only for a visit with no clock-in.
 */
export function formatDeltaLines(cell: DeltaCell): readonly string[] {
  if (!cell.clockIn && cell.inMin === undefined && cell.outMin === undefined) return ["No clock data"]
  const inLine = cell.inMin === undefined ? "In: no door arrival to compare" : `In ${formatDeltaMinutes(cell.inMin)}`
  return [inLine, deltaOutLine(cell)]
}
