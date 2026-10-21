import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { describe, expect, it } from "vitest"

import { createDocumentClient, createDynamoRepository } from "../src"
import { makeVisit } from "./fixtures"

/**
 * Runs the SDK's REAL marshalling (no aws-sdk-client-mock): a middleware at
 * the serialize step captures the marshalled input and short-circuits the
 * request, so nothing leaves the process and no credentials are resolved.
 */
const captureClient = (base: DynamoDBClient | DynamoDBDocumentClient) => {
  const captured: Record<string, unknown>[] = []
  base.middlewareStack.add(
    () => async (args) => {
      captured.push(args.input as Record<string, unknown>)
      return { output: { $metadata: {} }, response: {} }
    },
    { step: "build", priority: "high", name: "captureMarshalledInput" }
  )
  return captured
}

const offlineConfig = {
  region: "us-east-1",
  credentials: { accessKeyId: "offline", secretAccessKey: "offline" },
}

/** A reconciled visit as the engine emits it: optional fields present but undefined. */
const contradictedVisit = () =>
  makeVisit({
    status: "completed",
    reconciliation: {
      outcome: "contradicted",
      evvRecordId: "evv-1",
      clockIn: "2026-10-01T14:03:00.000Z",
      clockOut: undefined,
      deltaArrivalMin: 3,
      deltaDepartureMin: undefined,
    },
    narrative: undefined,
  })

describe("dynamo document client marshalling", () => {
  it("persists a reconciled visit whose optional fields are undefined", async () => {
    const doc = createDocumentClient({ region: "us-east-1" }, offlineConfig)
    const captured = captureClient(doc)
    const repo = createDynamoRepository({
      client: doc,
      config: { tableName: "t" },
    })

    await expect(repo.visits.put(contradictedVisit())).resolves.toBeUndefined()

    const item = (captured[0]?.Item ?? {}) as Record<
      string,
      { M?: Record<string, unknown> }
    >
    const reconciliation = item.reconciliation?.M ?? {}
    expect(Object.keys(reconciliation).sort()).toEqual([
      "clockIn",
      "deltaArrivalMin",
      "evvRecordId",
      "outcome",
    ])
    expect(item).not.toHaveProperty("narrative")
  })

  it("the SDK default (no translate config) throws on the same visit", async () => {
    const base = new DynamoDBClient(offlineConfig)
    captureClient(base)
    const repo = createDynamoRepository({
      client: DynamoDBDocumentClient.from(base),
      config: { tableName: "t" },
    })
    await expect(repo.visits.put(contradictedVisit())).rejects.toThrow(
      /removeUndefinedValues/
    )
  })
})
