/**
 * Replays the real Presence Engine (apps/engine: event processor and visit
 * sweeper) over the persisted door events in simulated time, against the
 * same local repository the console reads. The engine appends signed ledger
 * records as it produces observations and resolutions, the emulated Ring
 * device check feeds the observability overlay, and the caregiver's note is
 * filed at the moment it was written.
 */
import type { VisitProofRepository } from "@visitproof/db"
import type { DoorEvent, Note } from "@visitproof/domain"
import {
  createLocalHmacLedgerSigner,
  replayInSimulatedTime,
  repositoryEngineDeps,
  repositoryLedger,
  simulatedClock,
  type EngineDeps,
  type EvidenceLedger,
  type Logger,
} from "@visitproof/engine"
import {
  emulatedDeviceCheck,
  type TwoWeeksVisitPlan,
} from "@visitproof/ring-partner-sdk"

import type { DemoConfig } from "./config"
import { AGENCY_ID } from "./config"
import { audit } from "./fixtures"
import { log, warn } from "./log"

const MIN = 60_000
export const TICK_MS = 5 * MIN
/** Every visit has settled (departure quiet period, sweeper seal) by then. */
export const SETTLE_AFTER_END_MS = 90 * MIN

export const ledgerFor = (
  repo: VisitProofRepository,
  config: DemoConfig
): EvidenceLedger =>
  repositoryLedger(
    repo,
    createLocalHmacLedgerSigner({ secret: config.ledgerSecret })
  )

const quietLogger: Logger = {
  warn: (message, detail) =>
    warn("engine", `${message} ${JSON.stringify(detail ?? {})}`),
  error: (message, detail) =>
    warn("engine", `${message} ${JSON.stringify(detail ?? {})}`),
}

export interface PlannedNote {
  readonly note: Note
  readonly clientId: string
}

/** The caregiver's explanation on the first late visit, five minutes after arrival. */
export function plannedNote(
  plans: readonly TwoWeeksVisitPlan[],
  ids: readonly string[]
): PlannedNote | null {
  const index = plans.findIndex(
    (plan) => plan.kind === "late" && plan.arrivalAt !== null
  )
  const plan = plans[index]
  if (!plan || plan.arrivalAt === null) return null
  const at = new Date(plan.arrivalAt + 5 * MIN).toISOString()
  const note: Note = {
    ...audit(at),
    id: "note_caregiver_roadwork",
    visitId: ids[index]!,
    authorRole: "caregiver",
    authorId: plan.caregiver,
    at,
    text: "I was delayed by road work and arrived as soon as I could.",
    classification: "explanation",
    confidence: 0.82,
  }
  return { note, clientId: plan.clientId }
}

async function fileNote(
  repo: VisitProofRepository,
  ledger: EvidenceLedger,
  planned: PlannedNote
): Promise<void> {
  await repo.evidence.putNote(planned.note)
  await ledger.append({
    clientId: planned.clientId,
    column: "reported",
    subject: planned.note.id,
    payload: {
      kind: "caregiver_note",
      visitId: planned.note.visitId,
      text: planned.note.text,
    },
    at: new Date(planned.note.at),
  })
}

export async function persistedEvents(
  repo: VisitProofRepository
): Promise<DoorEvent[]> {
  const clients = await repo.clients.byAgency(AGENCY_ID)
  const groups = await Promise.all(
    clients.map((client) => repo.events.byClient(client.id))
  )
  return groups.flat()
}

export interface ReplayRun {
  readonly from: number
  readonly to: number
  readonly note: PlannedNote | null
}

export async function replayEngine(
  repo: VisitProofRepository,
  config: DemoConfig,
  plans: readonly TwoWeeksVisitPlan[],
  run: ReplayRun
): Promise<number> {
  const ledger = ledgerFor(repo, config)
  const clock = simulatedClock(run.from)
  const deps: EngineDeps = repositoryEngineDeps(repo, AGENCY_ID, {
    clock,
    ledger,
    logger: quietLogger,
    devices: {
      forClient: async (clientId, at) =>
        emulatedDeviceCheck(plans, clientId, at.getTime()),
    },
  })
  const events = await persistedEvents(repo)
  log(
    "engine",
    `${events.length} persisted door events; replaying ${Math.round((run.to - run.from) / MIN / 60)} hours in ${TICK_MS / MIN} minute ticks`
  )
  let noteFiled = run.note === null
  let nextDay = run.from + 24 * 60 * MIN
  const summary = await replayInSimulatedTime(
    deps,
    clock,
    { events, from: run.from, to: run.to, tickMs: TICK_MS },
    {
      onTick: async (tick) => {
        if (!noteFiled && run.note && tick >= Date.parse(run.note.note.at)) {
          await fileNote(repo, ledger, run.note)
          noteFiled = true
        }
        if (tick >= nextDay) {
          nextDay += 24 * 60 * MIN
          process.stdout.write(".")
        }
      },
    }
  )
  process.stdout.write("\n")
  log(
    "engine",
    `replay complete: ${summary.events} events ingested over ${summary.ticks} sweeps`
  )
  return summary.events
}
