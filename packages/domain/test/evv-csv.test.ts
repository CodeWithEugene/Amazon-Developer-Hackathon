import { describe, expect, it } from "vitest"

import {
  EVV_CSV_COLUMNS,
  formatEvvCsv,
  parseEvvCsv,
  splitCsvRows,
} from "../src/evv-csv"

const NOW = new Date("2026-10-02T00:00:00.000Z")
const OPTIONS = { agencyId: "a1", now: NOW, timeZone: "America/New_York" }
const HEADER = EVV_CSV_COLUMNS.join(",")

describe("splitCsvRows", () => {
  it("handles quoted commas, escaped quotes, CRLF, and a trailing newline", () => {
    const rows = splitCsvRows('a,"b, c","say ""hi"""\r\n1,2,3\n')
    expect(rows).toEqual([
      ["a", "b, c", 'say "hi"'],
      ["1", "2", "3"],
    ])
  })

  it("keeps a newline inside a quoted field", () => {
    expect(splitCsvRows('"line one\nline two",x')).toEqual([
      ["line one\nline two", "x"],
    ])
  })

  it("rejects an unterminated quote", () => {
    expect(() => splitCsvRows('"open,x')).toThrow(/unterminated/i)
  })
})

describe("parseEvvCsv", () => {
  it("parses local wall-clock times in the agency time zone", () => {
    const csv = `${HEADER}\nevv_1,cli_okoro,EVV-1001,T1019,2026-10-01 08:03,2026-10-01 10:01,mobile GPS,39.9612,-82.9988,v_okoro_00\n`
    const result = parseEvvCsv(csv, OPTIONS)
    expect(result.errors).toEqual([])
    expect(result.records).toHaveLength(1)
    const [record] = result.records
    expect(record).toMatchObject({
      id: "evv_1",
      clientId: "cli_okoro",
      agencyId: "a1",
      caregiverEvvId: "EVV-1001",
      serviceCode: "T1019",
      clockIn: "2026-10-01T12:03:00.000Z",
      clockOut: "2026-10-01T14:01:00.000Z",
      verificationMethod: "mobile GPS",
      lat: 39.9612,
      lng: -82.9988,
      source: "csv",
      visitId: "v_okoro_00",
      createdAt: NOW.toISOString(),
      version: 1,
    })
  })

  it("accepts ISO 8601 times with an offset and any column order", () => {
    const csv =
      "ServiceCode,ClockIn,CaregiverEvvId,ClientId\nT1019,2026-10-01T08:03:00-04:00,EVV-1,c1\n"
    const [record] = parseEvvCsv(csv, OPTIONS).records
    expect(record?.clockIn).toBe("2026-10-01T12:03:00.000Z")
    expect(record?.clockOut).toBeUndefined()
    expect(record?.lat).toBeUndefined()
    expect(record?.visitId).toBeUndefined()
  })

  it("derives a stable id when RecordId is blank", () => {
    const csv = `${HEADER}\n,c1,EVV-1,T1019,2026-10-01 08:03,,,,,\n`
    const first = parseEvvCsv(csv, OPTIONS).records[0]?.id
    expect(first).toMatch(/^evv_[0-9a-f]{16}$/)
    expect(parseEvvCsv(csv, OPTIONS).records[0]?.id).toBe(first)
  })

  it("reports each bad row with its line number and keeps the good rows", () => {
    const csv = [
      HEADER,
      "evv_1,c1,EVV-1,T1019,2026-10-01 08:03,,,,,",
      "evv_2,c1,EVV-1,T1019,not a time,,,,,",
      "evv_3,c1,EVV-1,T1019,2026-10-01 08:03,,,91,0,",
      "evv_4,,EVV-1,T1019,2026-10-01 08:03,,,,,",
    ].join("\n")
    const result = parseEvvCsv(csv, OPTIONS)
    expect(result.records.map((record) => record.id)).toEqual(["evv_1"])
    expect(result.errors.map((error) => error.line)).toEqual([3, 4, 5])
    expect(result.errors[0]?.message).toMatch(/ClockIn/)
  })

  it("rejects a local time when no time zone is given", () => {
    const csv = `${HEADER}\nevv_1,c1,EVV-1,T1019,2026-10-01 08:03,,,,,\n`
    const result = parseEvvCsv(csv, { agencyId: "a1", now: NOW })
    expect(result.records).toEqual([])
    expect(result.errors[0]?.message).toMatch(/time zone/i)
  })

  it("fails the whole file when a required column is missing", () => {
    const result = parseEvvCsv(
      "ClientId,ClockIn\nc1,2026-10-01 08:03\n",
      OPTIONS
    )
    expect(result.records).toEqual([])
    expect(result.errors).toEqual([
      {
        line: 1,
        message: "Missing required columns: CaregiverEvvId, ServiceCode",
      },
    ])
  })

  it("treats an empty file as having no header", () => {
    expect(parseEvvCsv("", OPTIONS).errors[0]?.line).toBe(1)
  })

  it("skips blank lines", () => {
    const csv = `${HEADER}\n\nevv_1,c1,EVV-1,T1019,2026-10-01 08:03,,,,,\n\n`
    expect(parseEvvCsv(csv, OPTIONS).records).toHaveLength(1)
  })
})

describe("formatEvvCsv", () => {
  it("round-trips through the parser, quoting fields that need it", () => {
    const csv = formatEvvCsv([
      {
        RecordId: "evv_1",
        ClientId: "c1",
        CaregiverEvvId: "EVV-1",
        ServiceCode: "T1019",
        ClockIn: "2026-10-01 08:03",
        ClockOut: "2026-10-01 10:01",
        VerificationMethod: 'GPS, "mobile"',
        Latitude: 39.5,
        Longitude: -82.25,
        VisitId: "v1",
      },
    ])
    expect(csv.split("\n")[0]).toBe(HEADER)
    const [record] = parseEvvCsv(csv, OPTIONS).records
    expect(record?.verificationMethod).toBe('GPS, "mobile"')
    expect(record?.lat).toBe(39.5)
    expect(record?.clockOut).toBe("2026-10-01T14:01:00.000Z")
  })
})
