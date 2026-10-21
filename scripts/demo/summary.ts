/**
 * The demo's closing summary, checked against the dataset in
 * docs/build.md Section 15: 84 visits, every signed delivery accepted,
 * 9 late arrivals, 4 no-shows, 5 early departures, 3 unobservable,
 * 6 contradicted and 8 missing clock-ins.
 */
import type { VisitProofRepository } from "@visitproof/db"
import {
  DEFAULT_TOLERANCES,
  type Reconciliation,
  type Visit,
} from "@visitproof/domain"

import { AGENCY_ID } from "./config"
import type { DeliveryCounts } from "./deliver"
import { log, warn } from "./log"

const MIN = 60_000

export interface DemoCounts {
  readonly visits: number
  readonly deliveriesSigned: number
  readonly deliveriesAccepted: number
  readonly duplicatesAbsorbed: number
  readonly late: number
  readonly noShows: number
  readonly earlyDepartures: number
  readonly unobservable: number
  readonly contradicted: number
  readonly missingClockIns: number
  readonly evvRecords: number
  readonly ledgerRecords: number
  readonly narratives: number
  readonly openExceptions: Readonly<Record<string, number>>
}

export const EXPECTED: Readonly<Partial<Record<keyof DemoCounts, number>>> = {
  visits: 84,
  late: 9,
  noShows: 4,
  earlyDepartures: 5,
  unobservable: 3,
  contradicted: 6,
  missingClockIns: 8,
}

const countBy = <T>(
  items: readonly T[],
  key: (item: T) => string
): Record<string, number> =>
  items.reduce<Record<string, number>>(
    (counts, item) => ({
      ...counts,
      [key(item)]: (counts[key(item)] ?? 0) + 1,
    }),
    {}
  )

const isLate = (visit: Visit): boolean =>
  visit.arrival !== undefined &&
  Date.parse(visit.arrival.at) >
    Date.parse(visit.scheduledStart) + DEFAULT_TOLERANCES.graceMin * MIN

export async function collectCounts(
  repo: VisitProofRepository,
  deliveries: DeliveryCounts,
  outcomes: readonly Reconciliation[]
): Promise<DemoCounts> {
  const clients = await repo.clients.byAgency(AGENCY_ID)
  const visits = (
    await Promise.all(clients.map((client) => repo.visits.byClient(client.id)))
  ).flat()
  const ledgers = await Promise.all(
    clients.map((client) => repo.evidence.ledgerByClient(client.id))
  )
  const evv = await Promise.all(
    clients.map((client) => repo.evvRecords.byClient(client.id))
  )
  const reconciled = countBy(outcomes, (outcome) => outcome.outcome)
  return {
    visits: visits.length,
    deliveriesSigned: deliveries.signed,
    deliveriesAccepted: deliveries.accepted,
    duplicatesAbsorbed: deliveries.duplicates,
    late: visits.filter(isLate).length,
    noShows: visits.filter((visit) => visit.status === "no_show").length,
    earlyDepartures: visits.filter(
      (visit) => visit.status === "early_departure"
    ).length,
    unobservable: visits.filter((visit) => visit.status === "unobservable")
      .length,
    contradicted: reconciled.contradicted ?? 0,
    missingClockIns: reconciled.missing_clock_in ?? 0,
    evvRecords: evv.flat().length,
    ledgerRecords: ledgers.flat().length,
    narratives: visits.filter((visit) => visit.narrative !== undefined).length,
    openExceptions: countBy(
      await repo.exceptions.byAgency(AGENCY_ID, "open"),
      (exception) => exception.kind
    ),
  }
}

/** Differences from the documented dataset (empty when everything matches). */
export function mismatches(counts: DemoCounts): string[] {
  const expected = Object.entries(EXPECTED).flatMap(([key, value]) => {
    const actual = counts[key as keyof DemoCounts]
    return actual === value
      ? []
      : [`${key}: expected ${value}, got ${JSON.stringify(actual)}`]
  })
  const deliveries =
    counts.deliveriesSigned >= 161 &&
    counts.deliveriesAccepted === counts.deliveriesSigned
      ? []
      : [
          `deliveries: expected 161 or more signed and all accepted, got ${counts.deliveriesAccepted} of ${counts.deliveriesSigned}`,
        ]
  return [...expected, ...deliveries]
}

export function printSummary(counts: DemoCounts, checked: boolean): void {
  log("summary", JSON.stringify(counts, null, 2))
  if (!checked) {
    log(
      "summary",
      "replay stopped at the wall clock (VISITPROOF_DEMO_UNTIL=now), so later visits are still scheduled"
    )
    return
  }
  const problems = mismatches(counts)
  if (problems.length === 0) {
    log(
      "summary",
      "matches docs/build.md Section 15 (84 visits, 9 late, 4 no-shows, 5 early, 3 unobservable, 6 contradicted, 8 missing clock-ins)"
    )
    return
  }
  for (const problem of problems) warn("summary", `MISMATCH ${problem}`)
}
