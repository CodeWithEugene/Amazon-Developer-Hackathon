import { describe, expect, it } from "vitest"

import { ledgerRecordSchema, visitSchema } from "../src/types"
import { visit } from "./helpers"

describe("schema extensions", () => {
  it("keeps raisedExceptionKinds on a visit and rejects unknown kinds", () => {
    const parsed = visitSchema.parse(visit({ raisedExceptionKinds: ["no_show"] }))
    expect(parsed.raisedExceptionKinds).toEqual(["no_show"])
    expect(visitSchema.safeParse({ ...visit(), raisedExceptionKinds: ["nope"] }).success).toBe(false)
  })

  it("accepts ledger records with and without a ledger version", () => {
    const record = {
      clientId: "c1",
      seq: 1,
      column: "observed",
      subject: "v1",
      payloadHash: "p",
      prevHash: "genesis",
      signature: "s",
      signerKeyId: "k",
      at: "2026-10-01T13:00:00.000Z",
    }
    expect(ledgerRecordSchema.parse(record).ledgerVersion).toBeUndefined()
    expect(ledgerRecordSchema.parse({ ...record, ledgerVersion: 2 }).ledgerVersion).toBe(2)
    expect(ledgerRecordSchema.safeParse({ ...record, ledgerVersion: 3 }).success).toBe(false)
  })
})
