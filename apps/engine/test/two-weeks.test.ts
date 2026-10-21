/**
 * Emulator to engine: the Ring emulator's two-week ground-truth plan is
 * replayed through the real event processor and visit sweeper in simulated
 * time, and the outcome counts must match docs/build.md Section 15.
 */
import {
  DEFAULT_TOLERANCES,
  doorEventSchema,
  localDateKey,
  type DoorEvent,
  type Visit,
} from "@visitproof/domain"
import {
  emulatedDeviceCheck,
  planTwoWeeks,
  type PlannedEvent,
  type TwoWeeksVisitPlan,
} from "@visitproof/ring-partner-sdk"
import { beforeAll, describe, expect, it } from "vitest"

import {
  inMemoryEngineDeps,
  replayInSimulatedTime,
  simulatedClock,
  type EngineDeps,
  type LedgerEntry,
} from "../src"
import { audit, silentLogger, testAgency, testClient } from "./helpers"

const MIN = 60_000
const DAY = 24 * 60 * MIN
const START_AT = Date.UTC(2026, 8, 15)
const TIME_ZONE = "America/New_York"

const DOOR_TYPE: Record<
  PlannedEvent["kind"],
  { type: DoorEvent["type"]; subType?: string } | null
> = {
  ding: { type: "ding" },
  motion_human: { type: "motion", subType: "human" },
  motion_vehicle: { type: "motion", subType: "vehicle" },
  motion_animal: { type: "motion", subType: "animal" },
  motion_other: { type: "motion", subType: "other_motion" },
  device_offline: { type: "device_offline" },
  device_online: { type: "device_online" },
  integration_removed: { type: "integration_removed" },
  integration_added: { type: "integration_added" },
  subscription_deactivated: null,
}

const toDoorEvents = (plan: TwoWeeksVisitPlan, index: number): DoorEvent[] =>
  plan.events.flatMap((planned, n) => {
    const mapped = DOOR_TYPE[planned.kind]
    if (mapped === null) return []
    return [
      doorEventSchema.parse({
        ...audit,
        clientId: plan.clientId,
        requestId: `${plan.clientId}-${index}-${n}`,
        timestampMs: planned.at,
        at: new Date(planned.at).toISOString(),
        ...mapped,
        deviceId: plan.deviceId,
        provenance: "emulated",
        rawPayloadHash: `hash-${plan.clientId}-${index}-${n}`,
      }),
    ]
  })

const toVisit = (plan: TwoWeeksVisitPlan, index: number): Visit => ({
  ...audit,
  id: `v_${plan.clientId}_${String(index).padStart(2, "0")}`,
  clientId: plan.clientId,
  agencyId: "a1",
  caregiverId: plan.caregiver,
  serviceCode: "T1019",
  date: localDateKey(new Date(plan.scheduledStartAt).toISOString(), TIME_ZONE),
  scheduledStart: new Date(plan.scheduledStartAt).toISOString(),
  scheduledEnd: new Date(plan.scheduledEndAt).toISOString(),
  status: "scheduled",
  observability: { state: "observable", reasons: [] },
})

interface Outcome {
  plans: readonly TwoWeeksVisitPlan[]
  visits: Visit[]
  deps: EngineDeps
  ledger: LedgerEntry[]
}

async function runTwoWeeks(): Promise<Outcome> {
  const plans = planTwoWeeks({ startAt: START_AT })
  const clientIds = [...new Set(plans.map((plan) => plan.clientId))]
  const visits = plans.map(toVisit)
  const events = plans.flatMap(toDoorEvents)
  const ledger: LedgerEntry[] = []
  const agency = testAgency()
  const deps: EngineDeps = {
    ...inMemoryEngineDeps({
      visits,
      clients: clientIds.map((id) => testClient({ id })),
    }),
    agencies: { get: async () => agency },
    devices: {
      forClient: async (clientId, at) =>
        emulatedDeviceCheck(plans, clientId, at.getTime()),
    },
    ledger: { append: async (entry) => void ledger.push(entry) },
    logger: silentLogger(),
  }
  for (const event of events) await deps.events.append(event)
  const end = Math.max(...plans.map((plan) => plan.scheduledEndAt)) + 90 * MIN
  await replayInSimulatedTime(deps, simulatedClock(START_AT), {
    events,
    from: START_AT,
    to: end,
    tickMs: 5 * MIN,
  })
  return { plans, visits: await deps.visits.listAll(), deps, ledger }
}

describe("two-week emulator replay through the engine", () => {
  let outcome: Outcome
  beforeAll(async () => {
    outcome = await runTwoWeeks()
  }, 120_000)

  const count = (predicate: (visit: Visit) => boolean) =>
    outcome.visits.filter(predicate).length

  it("covers 84 visits across 14 local days", () => {
    expect(outcome.visits).toHaveLength(84)
    expect(new Set(outcome.visits.map((visit) => visit.date)).size).toBe(14)
    expect(outcome.plans.at(-1)!.scheduledStartAt - START_AT).toBeLessThan(
      14 * DAY
    )
  })

  it("matches the planned outcome counts (9 late, 4 no-shows, 5 early, 3 unobservable)", () => {
    const graceMs = DEFAULT_TOLERANCES.graceMin * MIN
    const late = count(
      (visit) =>
        visit.arrival !== undefined &&
        Date.parse(visit.arrival.at) >
          Date.parse(visit.scheduledStart) + graceMs
    )
    expect(late).toBe(9)
    expect(count((visit) => visit.status === "no_show")).toBe(4)
    expect(count((visit) => visit.status === "early_departure")).toBe(5)
    expect(count((visit) => visit.status === "unobservable")).toBe(3)
    expect(count((visit) => visit.status === "completed")).toBe(72)
  })

  it("gives each unobservable visit its own reason", () => {
    const reasons = outcome.visits
      .filter((visit) => visit.status === "unobservable")
      .map((visit) => visit.observability.reasons.join("+"))
      .sort()
    expect(reasons).toEqual([
      "device_offline",
      "encrypted_device",
      "integration_removed",
    ])
  })

  it("never raises a card twice and ledgers every door event", async () => {
    const all = (
      await Promise.all(
        ["cli_okoro", "cli_nakamura", "cli_alvarez"].map((id) =>
          outcome.deps.exceptions.listForClient(id)
        )
      )
    ).flat()
    expect(new Set(all.map((exception) => exception.id)).size).toBe(all.length)
    const doorRecords = outcome.ledger.filter(
      (entry) => (entry.payload as { kind?: string }).kind === "door_event"
    )
    expect(doorRecords).toHaveLength(
      outcome.plans.flatMap((plan) => plan.events).length
    )
    const times = outcome.ledger.map((entry) => entry.at.getTime())
    expect([...times].sort((a, b) => a - b)).toEqual(times)
  })
})
