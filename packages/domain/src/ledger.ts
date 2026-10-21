/**
 * Canonical JSON, hashing, and the signed per-client ledger chain (EARS rule
 * 10; docs/solution.md Section 6.2 rule 6). Pure: hashing via node:crypto,
 * signatures via an injected signer (KMS ECDSA in production).
 *
 * Canonical JSON sorts object keys by UTF-16 code unit (the order of
 * Python's `json.dumps(sort_keys=True)` for the ASCII keys used here, and of
 * RFC 8785), drops undefined properties, serializes Date values as ISO
 * strings, and rejects values that JSON cannot represent faithfully.
 */
import { createHash } from "node:crypto"

import type { LedgerColumn, LedgerRecord } from "./types"

export type { LedgerColumn }

/** Current signing format; see {@link ledgerSigningHash}. */
export const LEDGER_VERSION = 2 as const

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

function canonicalPrimitive(value: unknown): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`canonicalJson cannot encode non-finite number ${value}`)
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`canonicalJson cannot encode a ${typeof value}`)
  }
  return JSON.stringify(value) ?? "null"
}

/** Deterministic canonical JSON: code-point sorted keys, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return canonicalPrimitive(value)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError("canonicalJson cannot encode an invalid Date")
    return JSON.stringify(value.toISOString())
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`
  }
  if (!isPlainObject(value)) {
    throw new TypeError(`canonicalJson cannot encode a ${value.constructor?.name ?? "non-plain"} object`)
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => byCodePoint(a, b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export type LedgerSigner = (payloadHash: string) => string

export interface SignLedgerInput {
  clientId: string
  seq: number
  column: LedgerColumn
  subject: string
  payload: unknown
  signerKeyId: string
  at: string
  prev?: LedgerRecord
  sign: LedgerSigner
}

type SigningFields = Pick<
  LedgerRecord,
  "clientId" | "seq" | "column" | "subject" | "payloadHash" | "prevHash"
> &
  Partial<Pick<LedgerRecord, "at" | "signerKeyId" | "ledgerVersion">>

/**
 * The digest the signer signs. Version 2 (current) covers the full record
 * context: client, sequence, column, subject, payload hash, chain link,
 * timestamp, and signer key, so neither the signature nor the time can be
 * lifted onto another record. Legacy records without `ledgerVersion` were
 * signed without `at` and `signerKeyId` and still verify under that form.
 */
export function ledgerSigningHash(record: SigningFields): string {
  const base = {
    clientId: record.clientId,
    seq: record.seq,
    column: record.column,
    subject: record.subject,
    payloadHash: record.payloadHash,
    prevHash: record.prevHash,
  }
  if (record.ledgerVersion !== LEDGER_VERSION) return canonicalHash(base)
  if (!record.at || !record.signerKeyId) {
    throw new TypeError("ledger v2 records must carry at and signerKeyId")
  }
  return canonicalHash({
    ...base,
    at: record.at,
    signerKeyId: record.signerKeyId,
    ledgerVersion: LEDGER_VERSION,
  })
}

/** Hash of a stored record for the next record's `prevHash`, over ledger fields only. */
export function ledgerRecordHash(record: LedgerRecord): string {
  return canonicalHash({
    clientId: record.clientId,
    seq: record.seq,
    column: record.column,
    subject: record.subject,
    payloadHash: record.payloadHash,
    prevHash: record.prevHash,
    signature: record.signature,
    signerKeyId: record.signerKeyId,
    at: record.at,
    ledgerVersion: record.ledgerVersion,
  })
}

/** Append a signed, hash-chained ledger record (EARS rule 10). */
export function signLedger(input: SignLedgerInput): LedgerRecord {
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    throw new RangeError(`ledger seq must be a positive integer, got ${input.seq}`)
  }
  if (input.prev && (input.prev.clientId !== input.clientId || input.prev.seq !== input.seq - 1)) {
    throw new RangeError("ledger prev must be the same client's record with seq - 1")
  }
  const context = {
    clientId: input.clientId,
    seq: input.seq,
    column: input.column,
    subject: input.subject,
    payloadHash: canonicalHash(input.payload),
    prevHash: input.prev ? ledgerRecordHash(input.prev) : "genesis",
    at: input.at,
    signerKeyId: input.signerKeyId,
    ledgerVersion: LEDGER_VERSION,
  }
  return { ...context, signature: input.sign(ledgerSigningHash(context)) }
}

/**
 * Verify a client's chain: one clientId, seq 1 first with prevHash
 * "genesis", each later seq exactly one more with prevHash the previous
 * record's hash, and every signature accepted by `verify` (which should
 * recompute {@link ledgerSigningHash} over the record).
 */
export function verifyChain(
  records: readonly LedgerRecord[],
  verify: (record: LedgerRecord) => boolean
): boolean {
  const sorted = [...records].sort((a, b) => a.seq - b.seq)
  const clientId = sorted[0]?.clientId
  return sorted.every((record, index) => {
    const prev = index > 0 ? sorted[index - 1] : undefined
    if (record.clientId !== clientId) return false
    if (record.seq !== (prev ? prev.seq + 1 : 1)) return false
    if (record.prevHash !== (prev ? ledgerRecordHash(prev) : "genesis")) return false
    return verify(record)
  })
}
