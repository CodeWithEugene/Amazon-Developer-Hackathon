/**
 * EVV clock record CSV import (docs/solution.md Section 6.2, "Marcus imports
 * the EVV export"). The documented shape is one row per clock record:
 *
 *   RecordId, ClientId, CaregiverEvvId, ServiceCode, ClockIn, ClockOut,
 *   VerificationMethod, Latitude, Longitude, VisitId
 *
 * Column order is free and header matching ignores case. ClientId,
 * CaregiverEvvId, ServiceCode and ClockIn are required. Times are ISO 8601
 * with an offset, or local wall-clock "YYYY-MM-DD HH:MM" in the agency time
 * zone. Every row is validated against the EVVRecord schema; a bad row is
 * reported with its line number and never stops the good rows.
 */
import { createHash } from "node:crypto"

import { zonedTimeToIso } from "./time"
import { evvRecordSchema, type EVVRecord } from "./types"

export const EVV_CSV_COLUMNS = [
  "RecordId",
  "ClientId",
  "CaregiverEvvId",
  "ServiceCode",
  "ClockIn",
  "ClockOut",
  "VerificationMethod",
  "Latitude",
  "Longitude",
  "VisitId",
] as const
export type EvvCsvColumn = (typeof EVV_CSV_COLUMNS)[number]

const REQUIRED_COLUMNS: readonly EvvCsvColumn[] = [
  "ClientId",
  "CaregiverEvvId",
  "ServiceCode",
  "ClockIn",
]
const LOCAL_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/
const ISO_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

export interface EvvCsvOptions {
  agencyId: string
  /** Import time for the audit fields. */
  now: Date
  /** Agency time zone; required when the file uses local wall-clock times. */
  timeZone?: string
}

export interface EvvCsvError {
  /** 1-based line number in the file (the header is line 1). */
  line: number
  message: string
}

export interface EvvCsvResult {
  records: EVVRecord[]
  errors: EvvCsvError[]
}

export type EvvCsvRow = Partial<Record<EvvCsvColumn, string | number>>

interface Cursor {
  rows: string[][]
  field: string
  row: string[]
  quoted: boolean
}

function endField(state: Cursor): void {
  state.row.push(state.field)
  state.field = ""
}

function endRow(state: Cursor): void {
  endField(state)
  state.rows.push(state.row)
  state.row = []
}

/** RFC 4180 rows: quoted fields may hold commas, doubled quotes, and newlines. */
export function splitCsvRows(text: string): string[][] {
  const state: Cursor = { rows: [], field: "", row: [], quoted: false }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!
    if (state.quoted) {
      if (char === '"' && text[index + 1] === '"') {
        state.field += '"'
        index += 1
      } else if (char === '"') state.quoted = false
      else state.field += char
    } else if (char === '"' && state.field === "") state.quoted = true
    else if (char === ",") endField(state)
    else if (char === "\n") endRow(state)
    else if (char !== "\r") state.field += char
  }
  if (state.quoted)
    throw new SyntaxError("CSV has an unterminated quoted field")
  if (state.field !== "" || state.row.length > 0) endRow(state)
  return state.rows
}

function parseTime(
  value: string,
  column: string,
  timeZone: string | undefined
): string {
  const local = LOCAL_TIME_PATTERN.exec(value)
  if (local) {
    if (!timeZone)
      throw new RangeError(
        `${column} is a local time but no agency time zone was given`
      )
    return zonedTimeToIso(
      local[1]!,
      Number(local[2]),
      Number(local[3]),
      timeZone
    )
  }
  if (!ISO_WITH_OFFSET_PATTERN.test(value) || Number.isNaN(Date.parse(value))) {
    throw new RangeError(
      `${column} "${value}" is not ISO 8601 with an offset or YYYY-MM-DD HH:MM`
    )
  }
  return new Date(Date.parse(value)).toISOString()
}

function parseNumber(value: string, column: string): number {
  const number = Number(value)
  if (!Number.isFinite(number))
    throw new RangeError(`${column} "${value}" is not a number`)
  return number
}

function derivedId(fields: Readonly<Record<string, string>>): string {
  const key = [
    fields.ClientId,
    fields.CaregiverEvvId,
    fields.ServiceCode,
    fields.ClockIn,
  ].join("|")
  return `evv_${createHash("sha256").update(key).digest("hex").slice(0, 16)}`
}

function optional<T>(
  value: string | undefined,
  parse: (raw: string) => T
): T | undefined {
  return value === undefined || value === "" ? undefined : parse(value)
}

function toRecord(
  fields: Readonly<Record<string, string>>,
  options: EvvCsvOptions
): EVVRecord {
  const at = options.now.toISOString()
  const clockOut = optional(fields.ClockOut, (raw) =>
    parseTime(raw, "ClockOut", options.timeZone)
  )
  const lat = optional(fields.Latitude, (raw) => parseNumber(raw, "Latitude"))
  const lng = optional(fields.Longitude, (raw) => parseNumber(raw, "Longitude"))
  const parsed = evvRecordSchema.safeParse({
    id: fields.RecordId || derivedId(fields),
    clientId: fields.ClientId,
    agencyId: options.agencyId,
    caregiverEvvId: fields.CaregiverEvvId,
    serviceCode: fields.ServiceCode,
    clockIn: parseTime(fields.ClockIn ?? "", "ClockIn", options.timeZone),
    ...(clockOut === undefined ? {} : { clockOut }),
    ...(fields.VerificationMethod
      ? { verificationMethod: fields.VerificationMethod }
      : {}),
    ...(lat === undefined ? {} : { lat }),
    ...(lng === undefined ? {} : { lng }),
    source: "csv",
    ...(fields.VisitId ? { visitId: fields.VisitId } : {}),
    createdAt: at,
    updatedAt: at,
    version: 1,
  })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new RangeError(
      `${issue?.path.join(".") || "row"}: ${issue?.message ?? "invalid"}`
    )
  }
  return parsed.data
}

function headerIndex(header: readonly string[]): Map<EvvCsvColumn, number> {
  const byLower = new Map(
    EVV_CSV_COLUMNS.map((column) => [column.toLowerCase(), column])
  )
  const index = new Map<EvvCsvColumn, number>()
  header.forEach((name, position) => {
    const column = byLower.get(name.trim().toLowerCase())
    if (column && !index.has(column)) index.set(column, position)
  })
  return index
}

/** Parse an EVV vendor export into validated EVVRecords (source "csv"). */
export function parseEvvCsv(
  text: string,
  options: EvvCsvOptions
): EvvCsvResult {
  let rows: string[][]
  try {
    rows = splitCsvRows(text)
  } catch (error) {
    return {
      records: [],
      errors: [{ line: 1, message: (error as Error).message }],
    }
  }
  const index = headerIndex(rows[0] ?? [])
  const missing = REQUIRED_COLUMNS.filter((column) => !index.has(column))
  if (missing.length > 0) {
    return {
      records: [],
      errors: [
        { line: 1, message: `Missing required columns: ${missing.join(", ")}` },
      ],
    }
  }
  const records: EVVRecord[] = []
  const errors: EvvCsvError[] = []
  rows.slice(1).forEach((cells, offset) => {
    if (cells.every((cell) => cell.trim() === "")) return
    const fields = Object.fromEntries(
      [...index].map(([column, position]) => [
        column,
        (cells[position] ?? "").trim(),
      ])
    )
    try {
      records.push(toRecord(fields, options))
    } catch (error) {
      errors.push({ line: offset + 2, message: (error as Error).message })
    }
  })
  return { records, errors }
}

function quote(value: string | number | undefined): string {
  const text = value === undefined ? "" : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Serialize rows in the documented column order (header included). */
export function formatEvvCsv(rows: readonly EvvCsvRow[]): string {
  const lines = [
    EVV_CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      EVV_CSV_COLUMNS.map((column) => quote(row[column])).join(",")
    ),
  ]
  return `${lines.join("\n")}\n`
}
