import { describe, expect, it } from "vitest"

import {
  canonicalHash,
  canonicalJson,
  LEDGER_VERSION,
  ledgerRecordHash,
  ledgerSigningHash,
  signLedger,
  verifyChain,
  type SignLedgerInput,
} from "../src/ledger"
import type { LedgerRecord } from "../src/types"

// A deterministic stand-in signer; the verifier recomputes the digest
const sign = (hash: string): string => `sig:${canonicalHash({ key: "k1", hash })}`
const verify = (record: LedgerRecord): boolean => record.signature === sign(ledgerSigningHash(record))

const base: Omit<SignLedgerInput, "seq" | "at"> = {
  clientId: "c1",
  column: "observed",
  subject: "v1",
  payload: { at: "2026-10-01T13:02:00.000Z" },
  signerKeyId: "key-1",
  sign,
}

function chain(length: number): LedgerRecord[] {
  return Array.from({ length }).reduce<LedgerRecord[]>((records, _, index) => {
    const prev = records.at(-1)
    const record = signLedger({
      ...base,
      seq: index + 1,
      at: `2026-10-01T13:0${index}:00.000Z`,
      ...(prev ? { prev } : {}),
    })
    return [...records, record]
  }, [])
}

describe("canonicalJson", () => {
  it("sorts keys by code point, like Python json.dumps(sort_keys=True)", () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _x: 4, Z: 5 })).toBe('{"B":2,"Z":5,"_x":4,"a":3,"b":1}')
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }))
  })

  it("serializes Dates as ISO strings and drops undefined properties", () => {
    expect(canonicalJson({ at: new Date("2026-10-01T13:00:00.000Z"), gone: undefined })).toBe(
      '{"at":"2026-10-01T13:00:00.000Z"}'
    )
    expect(canonicalJson([undefined, null, "x"])).toBe('[null,null,"x"]')
    expect(canonicalJson(Object.create(null) as object)).toBe("{}")
  })

  it("rejects values JSON cannot represent faithfully", () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(TypeError)
    expect(() => canonicalJson({ big: 1n })).toThrow(TypeError)
    expect(() => canonicalJson({ fn: () => 1 })).toThrow(TypeError)
    expect(() => canonicalJson({ map: new Map() })).toThrow(TypeError)
    expect(() => canonicalJson(new Date("nope"))).toThrow(TypeError)
  })

  it("matches a golden hash a stdlib verifier can recompute", () => {
    // python3 -c 'import json,hashlib;print(hashlib.sha256(json.dumps({"b":1,"a":"x"},sort_keys=True,separators=(",",":")).encode()).hexdigest())'
    expect(canonicalHash({ b: 1, a: "x" })).toBe("cdab067e9f3beb32d1252cfd63e492592fecbf591b0d08cadb24bb17f3864246")
  })
})

describe("signLedger and verifyChain", () => {
  it("signs version 2 records over at and signerKeyId and verifies the chain", () => {
    const records = chain(3)
    expect(records[0]!.ledgerVersion).toBe(LEDGER_VERSION)
    expect(records[0]!.prevHash).toBe("genesis")
    expect(records[1]!.prevHash).toBe(ledgerRecordHash(records[0]!))
    expect(verifyChain([...records].reverse(), verify)).toBe(true)
    expect(verifyChain([], verify)).toBe(true)
  })

  it("rejects a changed timestamp or signer key", () => {
    const records = chain(2)
    const retimed = { ...records[1]!, at: "2020-01-01T00:00:00.000Z" }
    expect(verifyChain([records[0]!, retimed], verify)).toBe(false)
    const rekeyed = { ...records[1]!, signerKeyId: "other" }
    expect(verifyChain([records[0]!, rekeyed], verify)).toBe(false)
  })

  it("rejects seq gaps, a wrong first seq, broken links, and mixed clients", () => {
    const records = chain(3)
    expect(verifyChain([records[0]!, records[2]!], verify)).toBe(false)
    expect(verifyChain([records[1]!], verify)).toBe(false)
    expect(verifyChain([records[0]!, { ...records[1]!, prevHash: "deadbeef" }], verify)).toBe(false)
    expect(verifyChain([records[0]!, { ...records[1]!, clientId: "c2" }], () => true)).toBe(false)
  })

  it("still verifies legacy version 1 records", () => {
    const legacy = (seq: number, prevHash: string): LedgerRecord => {
      const context = { clientId: "c1", seq, column: "observed" as const, subject: "v1", payloadHash: "p", prevHash }
      return { ...context, signature: sign(ledgerSigningHash(context)), signerKeyId: "key-1", at: "2026-10-01T13:00:00.000Z" }
    }
    const first = legacy(1, "genesis")
    const second = legacy(2, canonicalHash(first))
    expect(ledgerRecordHash(first)).toBe(canonicalHash(first))
    expect(verifyChain([first, second], verify)).toBe(true)
    const next = signLedger({ ...base, seq: 3, at: "2026-10-01T14:00:00.000Z", prev: second })
    expect(verifyChain([first, second, next], verify)).toBe(true)
  })

  it("refuses inconsistent inputs", () => {
    const [first] = chain(1)
    expect(() => signLedger({ ...base, seq: 0, at: "2026-10-01T13:00:00.000Z" })).toThrow(RangeError)
    expect(() => signLedger({ ...base, seq: 3, at: "2026-10-01T13:00:00.000Z", prev: first })).toThrow(RangeError)
    expect(() =>
      ledgerSigningHash({ clientId: "c1", seq: 1, column: "observed", subject: "v", payloadHash: "p", prevHash: "g", ledgerVersion: 2 })
    ).toThrow(TypeError)
  })
})
