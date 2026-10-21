import { describe, expect, it } from "vitest"

import {
  createEventProcessor,
  createExporter,
  createMailer,
  createVisitSweeper,
} from "../src"
import {
  doorEvent,
  streamRecord,
  testAgency,
  testDeps,
  testVisit,
} from "./helpers"

describe("event-processor batch item failures", () => {
  it("reports a failed record for retry and stops at it", async () => {
    const deps = testDeps("2026-10-01T11:58:10.000Z")
    let calls = 0
    const failing = {
      ...deps,
      visits: {
        ...deps.visits,
        listForClient: async () => {
          calls += 1
          throw Object.assign(new Error("Rate exceeded"), {
            name: "ProvisionedThroughputExceededException",
          })
        },
      },
    }
    const result = await createEventProcessor(failing)({
      Records: [
        streamRecord(
          { ...doorEvent("2026-10-01T11:58:00.000Z", "ding"), sk: "EVENT#1#a" },
          "100"
        ),
        streamRecord(
          { ...doorEvent("2026-10-01T11:58:30.000Z", "ding"), sk: "EVENT#2#b" },
          "200"
        ),
      ],
    })
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "100" }])
    expect(calls).toBe(1)
  })

  it("skips non-event and unparseable records without failing the batch", async () => {
    const deps = testDeps("2026-10-01T11:58:10.000Z")
    const result = await createEventProcessor(deps)({
      Records: [
        streamRecord({ pk: { S: "CLIENT#c1" }, sk: { S: "VISIT#x" } }, "1"),
        streamRecord({ garbage: { S: "true" } }, "2"),
        { ...streamRecord({}, "3"), eventName: "REMOVE" },
      ],
    })
    expect(result.batchItemFailures).toEqual([])
  })

  it("processes a good record and returns no failures", async () => {
    const deps = testDeps("2026-10-01T11:58:10.000Z")
    const result = await createEventProcessor(deps)({
      Records: [
        streamRecord({ ...doorEvent("2026-10-01T11:58:00.000Z", "ding") }, "1"),
      ],
    })
    expect(result.batchItemFailures).toEqual([])
    expect((await deps.visits.listForClient("c1"))[0]?.status).toBe(
      "arrived_on_time"
    )
  })
})

describe("agency tolerances", () => {
  it("the sweeper uses the agency grace period instead of the default", async () => {
    const at = "2026-10-01T12:20:00.000Z" // 20 minutes after the scheduled start
    const withDefault = testDeps(at)
    await createVisitSweeper(withDefault)({} as never)
    expect(
      (await withDefault.exceptions.listOpen()).map((e) => e.kind)
    ).toEqual(["late_no_arrival"])

    const lenient = testDeps(at, {
      agency: testAgency({
        tolerances: {
          graceMin: 30,
          escalationMin: 60,
          earlyDepartureMin: 10,
          departureQuietMin: 10,
        },
      }),
    })
    await createVisitSweeper(lenient)({} as never)
    expect(await lenient.exceptions.listOpen()).toEqual([])
  })

  it("the event processor classifies lateness with the agency grace period", async () => {
    const arrival = "2026-10-01T12:20:00.000Z"
    const strict = testDeps(arrival)
    await createEventProcessor(strict)({
      Records: [streamRecord({ ...doorEvent(arrival, "ding") }, "1")],
    })
    const lenient = testDeps(arrival, {
      agency: testAgency({
        tolerances: {
          graceMin: 30,
          escalationMin: 60,
          earlyDepartureMin: 10,
          departureQuietMin: 10,
        },
      }),
    })
    await createEventProcessor(lenient)({
      Records: [streamRecord({ ...doorEvent(arrival, "ding") }, "1")],
    })
    expect((await strict.visits.listForClient("c1"))[0]?.status).toBe(
      "arrived_late"
    )
    expect((await lenient.visits.listForClient("c1"))[0]?.status).toBe(
      "arrived_on_time"
    )
  })

  it("the exporter builds the pack with the agency tolerances", async () => {
    const deps = testDeps("2026-10-01T15:00:00.000Z", { agency: testAgency() })
    const result = await createExporter(deps)({
      clientId: "c1",
      date: "2026-10-01",
    })
    expect(result.evidenceKey).toBe("evidence/c1/2026-10-01.json")
  })
})

describe("mailer", () => {
  const completed = testVisit({
    status: "completed",
    arrival: { at: "2026-10-01T12:04:00.000Z", source: "rule" },
    departure: { at: "2026-10-01T14:01:00.000Z", source: "rule" },
  })

  it("sends the daily digest with agency-local times and no dashes in prose", async () => {
    const sent: { to: string; subject: string; text: string }[] = []
    const deps = {
      ...testDeps("2026-10-01T23:00:00.000Z", {
        visits: [completed],
        agency: testAgency(),
      }),
    }
    deps.mail = { send: async (input) => void sent.push(input) }
    await createMailer(deps)({ kind: "digest", clientId: "c1" })
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subject).toBe("VisitProof Daily Digest")
    expect(sent[0]?.text).toContain("Visit scheduled for 8:00 AM ET.")
    expect(sent[0]?.text).toContain("Arrival seen at 8:04 AM ET.")
    expect(sent[0]?.text).toContain("Departure seen at 10:01 AM ET.")
    expect(sent[0]?.text).not.toMatch(/[–—]/)
  })

  it("sends nothing to a client whose Ring link was removed", async () => {
    const sent: unknown[] = []
    const deps = testDeps("2026-10-01T23:00:00.000Z", { visits: [completed] })
    deps.clients = {
      get: async () => ({
        ...(await testDeps("x").clients.get("c1"))!,
        ringLinkStatus: "removed",
      }),
    }
    deps.mail = { send: async (input) => void sent.push(input) }
    await createMailer(deps)({ kind: "digest", clientId: "c1" })
    expect(sent).toEqual([])
  })

  it("renders exception alert times in the agency zone", async () => {
    const sent: string[] = []
    const deps = testDeps("2026-10-01T12:20:00.000Z", { agency: testAgency() })
    deps.mail = { send: async (input) => void sent.push(input.text) }
    await createVisitSweeper(deps)({} as never)
    await createMailer(deps)({ kind: "exception_alert", clientId: "c1" })
    expect(sent[0]).toContain("Late no arrival, opened at 8:20 AM ET.")
  })
})
