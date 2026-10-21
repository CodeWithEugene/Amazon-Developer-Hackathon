import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb"
import type { Agency } from "@visitproof/domain"
import { mockClient } from "aws-sdk-client-mock"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  createDynamoRepository,
  createLocalRepository,
  MalformedDataError,
} from "../src"
import { makeDoorEvent, makeNote, makeSnapshot, makeVisit } from "./fixtures"

const makeAgency = (overrides: Partial<Agency> = {}): Agency => ({
  id: "agency-1",
  name: "Caring Hands Home Care",
  state: "OH",
  timezone: "America/New_York",
  tolerances: {
    graceMin: 20,
    escalationMin: 50,
    earlyDepartureMin: 10,
    departureQuietMin: 10,
  },
  retentionDays: 365,
  notificationDefaults: { digestHour: 19, exceptionAlerts: true },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  version: 1,
  ...overrides,
})

const freshDir = () => mkdtemp(join(tmpdir(), "visitproof-db-ext-"))

describe("local repository: agencies, purge, validation", () => {
  it("round-trips agencies and falls back to the demo agency.json", async () => {
    const dir = await freshDir()
    const repo = createLocalRepository(dir)
    expect(await repo.agencies?.get("agency-1")).toBeNull()

    await writeFile(join(dir, "agency.json"), JSON.stringify(makeAgency()))
    expect((await repo.agencies?.get("agency-1"))?.tolerances.graceMin).toBe(20)
    expect(await repo.agencies?.get("other")).toBeNull()

    await repo.agencies?.put(
      makeAgency({ tolerances: { ...makeAgency().tolerances, graceMin: 5 } })
    )
    expect((await repo.agencies?.get("agency-1"))?.tolerances.graceMin).toBe(5)
  })

  it("deletes a client's events and a visit's notes and snapshots", async () => {
    const repo = createLocalRepository(await freshDir())
    await repo.events.put(makeDoorEvent())
    await repo.events.put(
      makeDoorEvent({ requestId: "req-2", timestampMs: 1_759_328_500_000 })
    )
    await repo.events.put(
      makeDoorEvent({ clientId: "client-2", requestId: "req-3" })
    )
    await repo.evidence.putNote(makeNote())
    await repo.evidence.putSnapshot(makeSnapshot())
    await repo.evidence.putNote(makeNote({ id: "note-2", visitId: "visit-2" }))

    expect(await repo.events.deleteByClient?.("client-1")).toBe(2)
    expect(await repo.events.byClient("client-1")).toEqual([])
    expect(await repo.events.byClient("client-2")).toHaveLength(1)
    expect(await repo.evidence.deleteByVisit?.("visit-1")).toEqual({
      notes: 1,
      snapshots: 1,
    })
    expect(await repo.evidence.notesByVisit("visit-2")).toHaveLength(1)
  })

  it("keeps the first delivery of a door event (idempotent on request id)", async () => {
    const repo = createLocalRepository(await freshDir())
    await repo.events.put(makeDoorEvent({ subType: "human" }))
    await repo.events.put(makeDoorEvent({ subType: "vehicle" }))
    const events = await repo.events.byClient("client-1")
    expect(events.map((e) => e.subType)).toEqual(["human"])
  })

  it("expires snapshots at their consent TTL", async () => {
    let now = new Date("2026-10-01T14:00:00.000Z")
    const repo = createLocalRepository(await freshDir(), { clock: () => now })
    const expiresAt = Math.floor(now.getTime() / 1000) + 60
    await repo.evidence.putSnapshot(makeSnapshot({ expiresAt }))
    expect(await repo.evidence.snapshotsByVisit("visit-1")).toHaveLength(1)
    now = new Date(now.getTime() + 120_000)
    expect(await repo.evidence.snapshotsByVisit("visit-1")).toEqual([])
  })

  it("rejects a stored row that fails its domain schema", async () => {
    const dir = await freshDir()
    const repo = createLocalRepository(dir)
    await repo.visits.put(makeVisit())
    const raw = JSON.parse(
      await readFile(join(dir, "visits.json"), "utf8")
    ) as {
      key: string
      item: Record<string, unknown>
    }[]
    const corrupt = raw.map((row) => ({
      ...row,
      item: { ...row.item, status: "teleported" },
    }))
    await writeFile(join(dir, "visits.json"), JSON.stringify(corrupt))
    await expect(
      createLocalRepository(dir).visits.byClient("client-1")
    ).rejects.toBeInstanceOf(MalformedDataError)
    expect(
      await createLocalRepository(dir, { validate: false }).visits.byClient(
        "client-1"
      )
    ).toHaveLength(1)
  })

  it("keeps attributes the domain schema does not know yet", async () => {
    const dir = await freshDir()
    const repo = createLocalRepository(dir)
    await repo.visits.put({ ...makeVisit(), futureField: "kept" } as ReturnType<
      typeof makeVisit
    >)
    const [visit] = await repo.visits.byClient("client-1")
    expect((visit as unknown as Record<string, unknown>).futureField).toBe(
      "kept"
    )
  })
})

describe("dynamo repository: agencies, purge, validation", () => {
  const ddb = mockClient(DynamoDBDocumentClient)
  afterEach(() => ddb.reset())
  const repo = () =>
    createDynamoRepository({
      client: DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: "us-east-1" })
      ),
      config: { tableName: "t" },
    })

  it("stores agencies under AGENCY#id / META", async () => {
    ddb.on(PutCommand).resolves({})
    ddb
      .on(GetCommand)
      .resolves({
        Item: { ...makeAgency(), pk: "AGENCY#agency-1", sk: "META" },
      })
    await repo().agencies?.put(makeAgency())
    expect(ddb.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({
      pk: "AGENCY#agency-1",
      sk: "META",
    })
    const agency = await repo().agencies?.get("agency-1")
    expect(agency?.tolerances.graceMin).toBe(20)
    expect(agency).not.toHaveProperty("pk")
  })

  it("batch-deletes a client's events and retries unprocessed items", async () => {
    const events = Array.from({ length: 30 }, (_, i) => ({
      ...makeDoorEvent({ requestId: `r-${i}` }),
      pk: "CLIENT#client-1",
      sk: `EVENT#${i}`,
    }))
    ddb.on(QueryCommand).resolves({ Items: events })
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: {
          t: [{ DeleteRequest: { Key: { pk: "x", sk: "y" } } }],
        },
      })
      .resolves({})
    expect(await repo().events.deleteByClient?.("client-1")).toBe(30)
    // 25 + retry of 1 unprocessed + 5
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(3)
  })

  it("raises MalformedDataError for an item that fails validation", async () => {
    ddb.on(QueryCommand).resolves({
      Items: [
        { ...makeVisit(), status: 42, pk: "CLIENT#client-1", sk: "VISIT#x" },
      ],
    })
    await expect(repo().visits.byClient("client-1")).rejects.toBeInstanceOf(
      MalformedDataError
    )
  })
})
