import { describe, expect, it } from "vitest"

import { openEvvExceptionIndicator, OPEN_EVV_EXPORT_FORMAT, toOpenEvvVisit } from "../src/openevv"
import type { EVVRecord } from "../src/types"
import { at, audit, END, START, visit } from "./helpers"

const evv = (clockIn: string, clockOut?: string): EVVRecord => ({
  ...audit,
  id: "evv1",
  clientId: "c1",
  agencyId: "a1",
  caregiverEvvId: "E1",
  serviceCode: "T1019",
  clockIn,
  clockOut,
  source: "csv",
  visitId: "v1",
})

const observed = {
  arrival: { at: at(START, 2), source: "rule" as const },
  departure: { at: at(END, 3), source: "rule" as const },
}

describe("toOpenEvvVisit", () => {
  it("puts EVV-reported times in the EVV fields and door times in their own fields", () => {
    const json = toOpenEvvVisit(visit({ status: "completed", ...observed }), evv(at(START, 4), at(END, 1)), {
      providerId: "a1",
    })
    expect(json).toEqual({
      ExportFormat: OPEN_EVV_EXPORT_FORMAT,
      VisitGUID: "v1",
      EVVWorkerID: "E1",
      ServiceCode: "T1019",
      ScheduleStartTime: START,
      ScheduleEndTime: END,
      StartDateTime: at(START, 4),
      EndDateTime: at(END, 1),
      DoorArrivalDateTime: at(START, 2),
      DoorDepartureDateTime: at(END, 3),
      ClientID: "c1",
      ProviderID: "a1",
      VisitStatus: "completed",
    })
  })

  it("never exports a no-show or unobservable visit as if it started on schedule", () => {
    const noShow = toOpenEvvVisit(visit({ status: "no_show" }))
    expect(noShow.StartDateTime).toBeUndefined()
    expect(noShow.ExceptionIndicator).toBe("NO_SHOW")
    const blind = toOpenEvvVisit(
      visit({ status: "unobservable", observability: { state: "unobservable", reasons: ["device_offline"] } })
    )
    expect(blind.StartDateTime).toBeUndefined()
    expect(blind.ExceptionIndicator).toBe("UNOBSERVABLE")
  })

  it("flags contradicted, missing clock-in, variance, ambiguous, and manual-only visits", () => {
    const contradicted = toOpenEvvVisit(visit({ status: "completed", ...observed }), evv(at(START, 45)))
    expect(contradicted.ExceptionIndicator).toBe("CONTRADICTED")
    expect(toOpenEvvVisit(visit({ status: "completed", ...observed })).ExceptionIndicator).toBe("MISSING_CLOCK_IN")
    const variance = toOpenEvvVisit(visit({ status: "completed", ...observed }), evv(at(START, 20)))
    expect(variance.ExceptionIndicator).toBe("TIME_VARIANCE")
    expect(openEvvExceptionIndicator(visit({ status: "ambiguous" }))).toBe("AMBIGUOUS_ARRIVAL")
    const manual = visit({ status: "completed", arrival: { at: START, source: "manual" } })
    const attested = toOpenEvvVisit(manual, evv(START))
    expect(attested.ExceptionIndicator).toBe("MISSING_DOOR_RECORD")
    expect(attested.DoorArrivalDateTime).toBeUndefined()
  })

  it("uses a stored reconciliation when no EVV record is passed", () => {
    const stored = visit({ status: "completed", ...observed, reconciliation: { outcome: "corroborated" } })
    expect(toOpenEvvVisit(stored).ExceptionIndicator).toBeUndefined()
  })
})
