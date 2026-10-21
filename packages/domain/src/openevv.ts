/**
 * "Open EVV style" visit export (docs/solution.md Section 5.5, Alternate
 * EVV JSON). This is modeled on the Sandata Open EVV visit segment so an
 * aggregator team can map it quickly; it is NOT a certified Open EVV
 * submission format, and VisitProof is not an EVV system of record.
 *
 * Field mapping against the Sandata Open EVV visit shape:
 *
 * | This export           | Open EVV visit field            | Source                                  |
 * |-----------------------|---------------------------------|-----------------------------------------|
 * | VisitGUID             | VisitOtherID                    | Visit.id                                |
 * | ProviderID            | ProviderIdentification          | Agency id, when the caller supplies it  |
 * | EVVWorkerID           | EmployeeIdentifier              | EVVRecord.caregiverEvvId                |
 * | ClientID              | ClientIdentifier                | Visit.clientId                          |
 * | ServiceCode           | ProcedureCode                   | EVVRecord.serviceCode or Visit          |
 * | ScheduleStartTime     | ScheduleStartTime               | Visit.scheduledStart (UTC)              |
 * | ScheduleEndTime       | ScheduleEndTime                 | Visit.scheduledEnd (UTC)                |
 * | StartDateTime         | Calls[CallAssignment=Time In]   | EVV clock-in only, never the schedule   |
 * | EndDateTime           | Calls[CallAssignment=Time Out]  | EVV clock-out only                      |
 * | DoorArrivalDateTime   | (no Open EVV field; Memo)       | Door-observed arrival (Observed column) |
 * | DoorDepartureDateTime | (no Open EVV field; Memo)       | Door-observed departure                 |
 * | ExceptionIndicator    | VisitExceptionAcknowledgement   | Engine status and reconciliation        |
 * | VisitStatus           | (no Open EVV field)             | Visit.status                            |
 *
 * All timestamps are UTC ISO 8601, as Open EVV requires.
 */
import { reconcile, isDoorBoundary } from "./reconcile"
import { DEFAULT_TOLERANCES, type EVVRecord, type Reconciliation, type Visit } from "./types"

export const OPEN_EVV_EXPORT_FORMAT = "open_evv_style" as const

export type OpenEvvExceptionIndicator =
  | "NO_SHOW"
  | "UNOBSERVABLE"
  | "AMBIGUOUS_ARRIVAL"
  | "CONTRADICTED"
  | "MISSING_CLOCK_IN"
  | "MISSING_DOOR_RECORD"
  | "TIME_VARIANCE"

export interface OpenEvvVisitJson {
  ExportFormat: typeof OPEN_EVV_EXPORT_FORMAT
  VisitGUID: string
  EVVWorkerID?: string
  ServiceCode: string
  ScheduleStartTime: string
  ScheduleEndTime: string
  /** EVV-reported clock-in; absent when no clock-in exists (never the schedule). */
  StartDateTime?: string
  /** EVV-reported clock-out. */
  EndDateTime?: string
  DoorArrivalDateTime?: string
  DoorDepartureDateTime?: string
  ClientID: string
  ProviderID?: string
  VisitStatus: Visit["status"]
  ExceptionIndicator?: OpenEvvExceptionIndicator
}

const OUTCOME_INDICATOR: Partial<Record<Reconciliation["outcome"], OpenEvvExceptionIndicator>> = {
  contradicted: "CONTRADICTED",
  missing_clock_in: "MISSING_CLOCK_IN",
  missing_both: "MISSING_CLOCK_IN",
  missing_door: "MISSING_DOOR_RECORD",
  corroborated_with_variance: "TIME_VARIANCE",
  unobservable: "UNOBSERVABLE",
}

/** The exception to flag on an exported visit, most serious first. */
export function openEvvExceptionIndicator(
  visit: Visit,
  evv?: EVVRecord
): OpenEvvExceptionIndicator | undefined {
  if (visit.status === "no_show") return "NO_SHOW"
  if (visit.status === "unobservable" || visit.observability.state === "unobservable") {
    return "UNOBSERVABLE"
  }
  if (visit.status === "ambiguous") return "AMBIGUOUS_ARRIVAL"
  const reconciliation =
    evv || !visit.reconciliation
      ? reconcile({ visit, evvRecords: evv ? [evv] : [], tolerances: DEFAULT_TOLERANCES })
      : visit.reconciliation
  return OUTCOME_INDICATOR[reconciliation.outcome]
}

/** One visit as an Open EVV style record (see the field mapping above). */
export function toOpenEvvVisit(
  visit: Visit,
  evv?: EVVRecord,
  options: { providerId?: string } = {}
): OpenEvvVisitJson {
  const doorArrival = isDoorBoundary(visit.arrival) ? visit.arrival.at : undefined
  const doorDeparture = isDoorBoundary(visit.departure) ? visit.departure.at : undefined
  const indicator = openEvvExceptionIndicator(visit, evv)
  return {
    ExportFormat: OPEN_EVV_EXPORT_FORMAT,
    VisitGUID: visit.id,
    ...(evv ? { EVVWorkerID: evv.caregiverEvvId } : {}),
    ServiceCode: evv?.serviceCode ?? visit.serviceCode,
    ScheduleStartTime: visit.scheduledStart,
    ScheduleEndTime: visit.scheduledEnd,
    ...(evv ? { StartDateTime: evv.clockIn } : {}),
    ...(evv?.clockOut ? { EndDateTime: evv.clockOut } : {}),
    ...(doorArrival ? { DoorArrivalDateTime: doorArrival } : {}),
    ...(doorDeparture ? { DoorDepartureDateTime: doorDeparture } : {}),
    ClientID: visit.clientId,
    ...(options.providerId ? { ProviderID: options.providerId } : {}),
    VisitStatus: visit.status,
    ...(indicator ? { ExceptionIndicator: indicator } : {}),
  }
}
