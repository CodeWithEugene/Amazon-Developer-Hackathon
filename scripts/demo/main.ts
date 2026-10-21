/**
 * VisitProof one-command demo (`pnpm demo`, README "Judge Quick Start").
 *
 *  1. preflight: every port is bind-tested and the store directory is
 *     checked and locked before anything is deleted;
 *  2. seed: agency, clients, caregivers, Ring links, and 84 visits from the
 *     emulator's two-week plan (agency-local dates);
 *  3. deliver: every signed emulator webhook goes over real HTTP to the
 *     receiver, which persists without running the engine;
 *  4. replay: the real engine handlers run in simulated time and append the
 *     signed ledger as they go;
 *  5. EVV: independent clock records (from the plan's ground truth) are
 *     written as a vendor CSV, imported through the domain parser, and
 *     reconciled; narratives follow in the agency time zone;
 *  6. serve: the MCP server and the console start over the same store.
 *
 * No AWS or Ring credentials are needed; the KMS signer is a local HMAC
 * stand-in and every Ring event comes from the emulator.
 */
import {
  createLocalRepository,
  type VisitProofRepository,
} from "@visitproof/db"

import { readDemoConfig, type DemoConfig } from "./config"
import { deliverAll, startWebhooks, type DeliveryCounts } from "./deliver"
import { importEvvCsv, writeEvvFixture } from "./evv"
import { log } from "./log"
import { anyServiceExit, servicePids } from "./processes"
import { preflightPorts } from "./ports"
import { reconcileAll, writeNarratives } from "./reconcile"
import { ledgerFor, plannedNote, replayEngine } from "./replay"
import { seedStore } from "./seed"
import { readyBanner, startConsole, startMcp } from "./services"
import {
  acquireStoreLock,
  assertResettable,
  resetStore,
  type StoreLock,
} from "./store-guard"
import { collectCounts, printSummary } from "./summary"
import { demoWindow, type DemoWindow } from "./window"

async function prepareStore(config: DemoConfig): Promise<StoreLock> {
  await preflightPorts([
    { name: "console (PORT)", port: config.consolePort },
    { name: "webhooks (WEBHOOK_PORT)", port: config.webhookPort },
    { name: "MCP (MCP_PORT)", port: config.mcpPort },
  ])
  await assertResettable(config.storeDir, config.root)
  const lock = await acquireStoreLock(config.storeDir)
  const kept = await resetStore(config.storeDir)
  log(
    "store",
    `fresh demo store at ${config.storeDir}${kept.length > 0 ? ` (kept ${kept.join(", ")})` : ""}`
  )
  return lock
}

const day = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 10)

async function ingest(
  config: DemoConfig,
  repo: VisitProofRepository,
  window: DemoWindow
): Promise<DeliveryCounts> {
  const { replay } = window
  log(
    "emulator",
    `${replay.visits.length} planned visits, ${replay.deliveries.length} signed deliveries, ${day(replay.startAt)} to ${day(replay.endAt)} (${replay.timeZone})`
  )
  const seed = await seedStore(repo, config.storeDir, replay)
  log(
    "seed",
    `${replay.clients.length} clients, ${seed.caregivers} caregivers, ${replay.clients.length} Ring links, ${seed.visitIds.length} scheduled visits`
  )
  await startWebhooks(config)
  const counts = await deliverAll(config, replay.deliveries)
  await replayEngine(repo, config, replay.visits, {
    from: window.from,
    to: window.to,
    note: plannedNote(replay.visits, seed.visitIds),
  })
  return counts
}

async function reconcileAndNarrate(
  config: DemoConfig,
  repo: VisitProofRepository,
  window: DemoWindow
) {
  const happened = window.replay.visits.filter(
    (plan) => plan.evv.clockInAt !== null && plan.evv.clockInAt <= window.to
  )
  const path = await writeEvvFixture(config.storeDir, happened)
  const importedAt = new Date(window.to)
  const records = await importEvvCsv(
    repo,
    ledgerFor(repo, config),
    path,
    importedAt
  )
  log(
    "evv",
    `${records.length} clock records imported from ${path} through the domain CSV parser`
  )
  const outcomes = await reconcileAll(repo, importedAt)
  const narratives = await writeNarratives(repo, { now: () => importedAt })
  log(
    "evv",
    `reconciled ${outcomes.length} visits; ${narratives} narratives written in the agency time zone`
  )
  return outcomes
}

/** Says so when the replay settled visits the wall clock has not reached yet. */
function noteClock(window: DemoWindow): void {
  const ahead = window.to - Date.now()
  if (ahead <= 0) return
  log(
    "clock",
    `the replay ran ${Math.round(ahead / 60_000)} minutes past the wall clock so every visit settles; ` +
      "today's later visits show their planned outcome early. Set VISITPROOF_DEMO_UNTIL=now to stop at the current time."
  )
}

export async function runDemo(
  onLock: (lock: StoreLock) => void
): Promise<string> {
  const config = readDemoConfig(process.env)
  onLock(await prepareStore(config))
  const window = demoWindow(Date.now(), config.until, config.signingKey)
  const repo = createLocalRepository(config.storeDir)
  const deliveries = await ingest(config, repo, window)
  const outcomes = await reconcileAndNarrate(config, repo, window)
  printSummary(await collectCounts(repo, deliveries, outcomes), window.complete)
  noteClock(window)
  await startMcp(config)
  await startConsole(config)
  process.stdout.write(readyBanner(config, servicePids()))
  return anyServiceExit()
}
