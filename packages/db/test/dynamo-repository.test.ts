import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import { mockClient } from "aws-sdk-client-mock"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createDynamoRepository } from "../src"
import type { VisitProofRepository } from "../src"
import {
  makeCaregiver,
  makeClient,
  makeDoorEvent,
  makeEvvRecord,
  makeException,
  makeLedgerRecord,
  makeNote,
  makeSnapshot,
  makeVisit,
} from "./fixtures"

/**
 * A tiny in-memory DynamoDB over the mocked document client: Put, Get,
 * Delete, and Query (pk + begins_with sk, gs1) with conditional-put
 * semantics, so the repository's real command logic is exercised.
 */
type Item = Record<string, unknown> & { pk: string; sk: string }

const createFakeTable = () => {
  const items = new Map<string, Item>()
  const keyOf = (item: Record<string, unknown>) => `${String(item.pk)}|${String(item.sk)}`
  const conditionalFailure = () => {
    const error = new Error("The conditional request failed")
    error.name = "ConditionalCheckFailedException"
    return error
  }
  const validationFailure = (message: string) => {
    const error = new Error(message)
    error.name = "ValidationException"
    return error
  }
  /**
   * DynamoDB rejects an expression that references #name tokens the
   * ExpressionAttributeNames map does not define. Mirror that here so the
   * test suite catches a condition/key expression missing its names map.
   */
  const validateExpressionNames = (input: {
    ConditionExpression?: string
    KeyConditionExpression?: string
    ExpressionAttributeNames?: Record<string, string>
  }) => {
    const expression = `${input.ConditionExpression ?? ""} ${input.KeyConditionExpression ?? ""}`
    const tokens = new Set([...expression.matchAll(/#\w+/g)].map((match) => match[0]))
    for (const token of tokens) {
      if (input.ExpressionAttributeNames?.[token] === undefined) {
        throw validationFailure(
          `An expression attribute name used in the document path is not defined: ${token}`
        )
      }
    }
  }
  return {
    items,
    apply(ddb: ReturnType<typeof mockClient>) {
      ddb.on(PutCommand).callsFake(async (input: {
        Item: Item
        ConditionExpression?: string
        ExpressionAttributeNames?: Record<string, string>
      }) => {
        validateExpressionNames(input)
        const key = keyOf(input.Item)
        if (
          input.ConditionExpression?.includes("attribute_not_exists") &&
          items.has(key)
        ) {
          throw conditionalFailure()
        }
        items.set(key, input.Item)
        return {}
      })
      ddb.on(GetCommand).callsFake(async (input: { Key: Item }) => ({
        Item: items.get(keyOf(input.Key)),
      }))
      ddb.on(DeleteCommand).callsFake(async (input: { Key: Item }) => {
        items.delete(keyOf(input.Key))
        return {}
      })
      ddb.on(QueryCommand).callsFake(async (input: {
        KeyConditionExpression?: string
        ExpressionAttributeNames?: Record<string, string>
        ExpressionAttributeValues?: Record<string, unknown>
        ExclusiveStartKey?: Item
      }) => {
        validateExpressionNames(input)
        const values = input.ExpressionAttributeValues ?? {}
        const pk = values[":pk"]
        const gpk = values[":gpk"]
        const prefix = typeof values[":sk"] === "string" ? values[":sk"] : undefined
        const gprefix =
          typeof values[":gsk"] === "string" ? values[":gsk"] : undefined
        const found = [...items.values()].filter((item) => {
          if (gpk !== undefined) {
            if (item.gsi1pk !== gpk) return false
            return gprefix === undefined || String(item.gsi1sk).startsWith(gprefix)
          }
          if (item.pk !== pk) return false
          return prefix === undefined || item.sk.startsWith(prefix)
        })
        return { Items: found }
      })
    },
  }
}

const ddb = mockClient(DynamoDBDocumentClient)
let repo: VisitProofRepository
const table = createFakeTable()

beforeEach(() => {
  ddb.reset()
  table.items.clear()
  table.apply(ddb)
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }))
  repo = createDynamoRepository({
    client,
    config: { tableName: "visitproof-test", region: "us-east-1" },
  })
})

afterEach(() => {
  ddb.reset()
})

describe("dynamo repository round-trip", () => {
  it("round-trips clients with consent updates", async () => {
    const client = makeClient()
    await repo.clients.put(client)
    // stored items carry the pk/sk key columns alongside the entity attributes
    expect(await repo.clients.get("agency-1", "client-1")).toEqual(
      expect.objectContaining(client)
    )
    expect(await repo.clients.byAgency("agency-1")).toEqual([
      expect.objectContaining(client),
    ])

    const updated = await repo.clients.saveConsent(
      "agency-1",
      "client-1",
      { ...client.consent, shareWithAgency: false },
      new Date("2026-10-01T10:00:00.000Z")
    )
    expect(updated.consent.shareWithAgency).toBe(false)
    expect(updated.version).toBe(2)
    await expect(
      repo.clients.saveConsent("agency-1", "missing", client.consent, new Date())
    ).rejects.toThrow(/not found/)
  })

  it("round-trips visits by client and by agency/date over gsi1", async () => {
    const early = makeVisit({
      id: "visit-early",
      scheduledStart: "2026-10-01T12:00:00.000Z",
      scheduledEnd: "2026-10-01T14:00:00.000Z",
    })
    await repo.visits.put(makeVisit())
    await repo.visits.put(early)

    expect((await repo.visits.byClient("client-1")).map((v) => v.id)).toEqual([
      "visit-1",
      "visit-early",
    ])
    const today = await repo.visits.byAgencyAndDate("agency-1", "2026-10-01")
    expect(today.map((v) => v.id)).toEqual(["visit-early", "visit-1"])
    expect(await repo.visits.byAgencyAndDate("agency-1", "2026-10-02")).toEqual([])
  })

  it("absorbs duplicate door event puts idempotently", async () => {
    const event = makeDoorEvent()
    await repo.events.put(event)
    await repo.events.put(event) // same request id: absorbed, not thrown
    const stored = await repo.events.byClient("client-1")
    expect(stored).toHaveLength(1)
    expect(stored[0]?.requestId).toBe("req-1")
  })

  it("round-trips exceptions, caregivers, and EVV records", async () => {
    await repo.exceptions.put(makeException())
    await repo.caregivers.put(makeCaregiver())
    await repo.evvRecords.put(makeEvvRecord())

    expect((await repo.exceptions.byAgency("agency-1", "open")).map((e) => e.id)).toEqual([
      "exc-1",
    ])
    expect(await repo.exceptions.get("agency-1", "exc-1")).toBeTruthy()
    expect((await repo.caregivers.byAgency("agency-1")).map((c) => c.id)).toEqual(["cg-1"])
    expect((await repo.evvRecords.byClient("client-1")).map((r) => r.id)).toEqual(["evv-1"])
  })

  it("round-trips evidence and enforces the append-only ledger", async () => {
    await repo.evidence.putNote(makeNote())
    await repo.evidence.putSnapshot(makeSnapshot())
    await repo.evidence.appendLedger(makeLedgerRecord(0))
    await expect(repo.evidence.appendLedger(makeLedgerRecord(0))).rejects.toThrow(
      /conditional request failed/
    )
    expect((await repo.evidence.notesByVisit("visit-1")).map((n) => n.id)).toEqual(["note-1"])
    expect((await repo.evidence.ledgerByClient("client-1")).map((r) => r.seq)).toEqual([0])
  })

  it("links Ring accounts and claims webhook receipts once", async () => {
    await repo.ringLinks.link("client-1", "acct-1", new Date())
    expect(await repo.ringLinks.clientIdFor("acct-1")).toBe("client-1")
    await repo.ringLinks.unlink("acct-1")
    expect(await repo.ringLinks.clientIdFor("acct-1")).toBeNull()

    const now = new Date("2026-10-01T14:00:00.000Z")
    expect(await repo.webhookReceipts.claim("req-abc", now)).toBe(true)
    expect(await repo.webhookReceipts.claim("req-abc", now)).toBe(false)
  })

  it("writes key columns and gsi1 on every stored item", async () => {
    await repo.visits.put(makeVisit())
    const item = [...table.items.values()].find((i) => i.sk.startsWith("VISIT#"))
    expect(item?.pk).toBe("CLIENT#client-1")
    expect(item?.gsi1pk).toBe("AGENCY#agency-1")
    expect(String(item?.gsi1sk).startsWith("DATE#2026-10-01#")).toBe(true)
  })
})
