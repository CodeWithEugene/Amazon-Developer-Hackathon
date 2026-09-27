/**
 * VisitProof one-command demo (`pnpm demo`, README "Judge Quick Start").
 *
 * Replays the Ring emulator's two-week dataset through the real pipeline:
 *   1. fresh local store (.demo-data/) seeded with agency, clients,
 *      caregivers, Ring account links, and the 84 scheduled visits;
 *   2. the webhooks app (apps/webhooks) receives every emulator delivery as a
 *      signed v1.1 webhook over real HTTP, verifying HMAC and dedupe;
 *   3. the Presence Engine (processEvent + sweepVisits from @visitproof/domain)
 *      replays the window in simulated time, producing visit statuses and
 *      exception cards;
 *   4. EVV clock-ins are seeded, reconciliation runs for every visit, and the
 *      signed evidence ledger is appended per client;
 *   5. the console starts on http://localhost:3000 against the seeded store.
 *
 * No AWS or Ring credentials needed; the KMS signer is a local HMAC stand-in.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createHmac } from "node:crypto"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createLocalRepository } from "@visitproof/db"
import {
  DEFAULT_TOLERANCES,
  buildNarrative,
  processEvent,
  reconcile,
  signLedger,
  sweepVisits,
  systemResolution,
  type Caregiver,
  type Client,
  type DoorEvent,
  type EVVRecord,
  type Exception,
  type Note,
  type ObservabilityReason,
  type Visit,
} from "@visitproof/domain"
import { RingEmulator, TWO_WEEKS_DAY_MS } from "@visitproof/ring-partner-sdk"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const STORE_DIR = process.env.VISITPROOF_DEMO_STORE_PATH ?? join(ROOT, ".demo-data")
const AGENCY_ID = "a1"
const SIGNING_KEY = process.env.RING_HMAC_SIGNING_KEY ?? "visitproof-demo-signing-key"
const WEBHOOK_PORT = Number(process.env.WEBHOOK_PORT ?? 3101)
const CONSOLE_PORT = Number(process.env.PORT ?? 3000)
const TOLERANCES = DEFAULT_TOLERANCES
const MIN = 60_000

/** Matches apps/console/lib/store.ts (local stand-in for the KMS signer). */
const LEDGER_SIGNER = { keyId: "local-demo/ledger-signing-key", secret: "visitproof-local-demo-ledger" }
const sign = (hash: string): string =>
  createHmac("sha256", LEDGER_SIGNER.secret).update(hash).digest("hex")

const CAREGIVERS: Record<string, { name: string; evvEmployeeId: string; mobile: string }> = {
  cg_amara: { name: "Amara Okafor", evvEmployeeId: "EVV-1001", mobile: "+15550000001" },
  cg_daniel: { name: "Daniel Reyes", evvEmployeeId: "EVV-1002", mobile: "+15550000002" },
  cg_yuki: { name: "Yuki Tanaka", evvEmployeeId: "EVV-1003", mobile: "+15550000003" },
  cg_priya: { name: "Priya Sharma", evvEmployeeId: "EVV-1004", mobile: "+15550000004" },
  cg_marisol: { name: "Marisol Vega", evvEmployeeId: "EVV-1005", mobile: "+15550000005" },
  cg_ana: { name: "Ana Ruiz", evvEmployeeId: "EVV-1006", mobile: "+15550000006" },
}

const CLIENT_INFO: Record<
  string,
  {
    name: string
    homeLabel: string
    familyName: string
    familyEmail: string
    relationship: string
    serviceCode: string
    unobservableReason: ObservabilityReason
  }
> = {
  cli_okoro: {
    name: "Grace Okoro",
    homeLabel: "Maple Street",
    familyName: "Priya Okoro",
    familyEmail: "priya@example.com",
    relationship: "Daughter",
    serviceCode: "T1019",
    unobservableReason: "device_offline",
  },
  cli_nakamura: {
    name: "Ken Nakamura",
    homeLabel: "Elm Court",
    familyName: "Mika Nakamura",
    familyEmail: "mika@example.com",
    relationship: "Son",
    serviceCode: "T1019",
    unobservableReason: "encrypted_device",
  },
  cli_alvarez: {
    name: "Rosa Alvarez",
    homeLabel: "Cedar Avenue",
    familyName: "Luis Alvarez",
    familyEmail: "luis@example.com",
    relationship: "Son",
    serviceCode: "G0299",
    unobservableReason: "integration_removed",
  },
}

const log = (step: string, message: string): void => {
  process.stdout.write(`[demo] ${step}: ${message}\n`)
}

const waitFor = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await fetch(url)
      return
    } catch {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`)
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
  }
}

const children: ChildProcess[] = []
const runService = (name: string, args: string[], env: Record<string, string>): void => {
  const child = spawn("pnpm", args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  children.push(child)
}

const audit = (at: string) => ({ createdAt: at, updatedAt: at, version: 1 })

async function main(): Promise<void> {
  log("store", `fresh local repository at ${STORE_DIR}`)
  await rm(STORE_DIR, { recursive: true, force: true })
  await mkdir(STORE_DIR, { recursive: true })

  const midnight = new Date()
  midnight.setUTCHours(0, 0, 0, 0)
  const startAt = midnight.getTime() - 13 * TWO_WEEKS_DAY_MS
  const emulator = new RingEmulator({ signingKey: SIGNING_KEY })
  const replay = emulator.twoWeeks({ startAt })
  log(
    "emulator",
    `two-week replay: ${replay.visits.length} visits, ${replay.deliveries.length} signed deliveries, ` +
      `window ${new Date(replay.startAt).toISOString().slice(0, 10)} to ${new Date(replay.endAt).toISOString().slice(0, 10)} (last day is today)`,
  )

  // -- 1. Seed agency, people, links, schedule ------------------------------
  const seedRepo = createLocalRepository(STORE_DIR)
  const seedIso = new Date(replay.startAt).toISOString()
  await writeFile(
    join(STORE_DIR, "agency.json"),
    `${JSON.stringify(
      {
        id: AGENCY_ID,
        name: "Caring Hands Home Care",
        state: "OH",
        timezone: "America/New_York",
        tolerances: TOLERANCES,
        retentionDays: 365,
        evvVendor: "State EVV Portal",
        notificationDefaults: { digestHour: 19, exceptionAlerts: true },
        ...audit(seedIso),
      },
      null,
      2,
    )}\n`,
  )

  for (const client of replay.clients) {
    const info = CLIENT_INFO[client.clientId]!
    const entity: Client = {
      ...audit(seedIso),
      id: client.clientId,
      agencyId: AGENCY_ID,
      name: info.name,
      homeLabel: info.homeLabel,
      familyContacts: [
        { name: info.familyName, email: info.familyEmail, relationship: info.relationship },
      ],
      ringLinkStatus: "linked",
      consent: {
        shareWithAgency: true,
        snapshotsEnabled: client.clientId === "cli_okoro",
        snapshotRetentionDays: 7,
        digestHour: 19,
        exceptionAlerts: true,
        consentedAt: seedIso,
      },
      serviceCodes: [info.serviceCode],
    }
    await seedRepo.clients.put(entity)
    await seedRepo.ringLinks.link(client.clientId, client.accountId, new Date(seedIso))
  }

  const caregiverIds = [...new Set(replay.visits.map((visit) => visit.caregiver))]
  for (const id of caregiverIds) {
    const info = CAREGIVERS[id]!
    const caregiver: Caregiver = {
      ...audit(seedIso),
      id,
      agencyId: AGENCY_ID,
      name: info.name,
      mobile: info.mobile,
      email: `${id.replace("cg_", "")}@example.com`,
      evvEmployeeId: info.evvEmployeeId,
    }
    await seedRepo.caregivers.put(caregiver)
  }

  const perClientIndex = new Map<string, number>()
  const visitIdByPlan = new Map<string, string>()
  for (const plan of replay.visits) {
    const index = perClientIndex.get(plan.clientId) ?? 0
    perClientIndex.set(plan.clientId, index + 1)
    const id = `v_${plan.clientId.replace("cli_", "")}_${String(index).padStart(2, "0")}`
    visitIdByPlan.set(`${plan.clientId}:${plan.scheduledStartAt}`, id)
    const info = CLIENT_INFO[plan.clientId]!
    const visit: Visit = {
      ...audit(new Date(plan.scheduledStartAt).toISOString()),
      id,
      clientId: plan.clientId,
      agencyId: AGENCY_ID,
      caregiverId: plan.caregiver,
      serviceCode: info.serviceCode,
      date: new Date(plan.scheduledStartAt).toISOString().slice(0, 10),
      scheduledStart: new Date(plan.scheduledStartAt).toISOString(),
      scheduledEnd: new Date(plan.scheduledEndAt).toISOString(),
      authorizedUnits: 8,
      status: "scheduled",
      observability: { state: "observable", reasons: [] },
    }
    await seedRepo.visits.put(visit)
  }
  log(
    "seed",
    `3 clients, ${caregiverIds.length} caregivers, 3 Ring links, ${replay.visits.length} scheduled visits`,
  )

  // -- 2. Deliver signed webhooks over real HTTP ----------------------------
  runService(
    "webhooks",
    ["--filter", "@visitproof/webhooks", "exec", "tsx", "src/server.ts"],
    {
      PORT: String(WEBHOOK_PORT),
      VISITPROOF_DEMO_STORE_PATH: STORE_DIR,
      RING_HMAC_SIGNING_KEY: SIGNING_KEY,
    },
  )
  await waitFor(`http://localhost:${WEBHOOK_PORT}/health`, 30_000)
  log("webhooks", `receiver up on :${WEBHOOK_PORT}, posting ${replay.deliveries.length} deliveries`)

  let accepted = 0
  let duplicates = 0
  for (const delivery of replay.deliveries) {
    const response = await fetch(`http://localhost:${WEBHOOK_PORT}/webhooks/ring`, {
      method: "POST",
      headers: delivery.headers,
      // exact signed bytes; cast only to satisfy the DOM BodyInit typing
      body: delivery.rawBody as unknown as BodyInit,
    })
    if (response.status !== 202) {
      throw new Error(`webhook rejected with ${response.status}: ${await response.text()}`)
    }
    const body = (await response.json()) as { duplicate?: boolean }
    if (body.duplicate) duplicates += 1
    else accepted += 1
  }
  log("webhooks", `${accepted} accepted, ${duplicates} duplicates, 0 signature failures`)

  // -- 3. Replay the Presence Engine in simulated time ----------------------
  const repo = createLocalRepository(STORE_DIR)
  const clients = await repo.clients.byAgency(AGENCY_ID)
  const allEvents: DoorEvent[] = []
  for (const client of clients) {
    allEvents.push(...(await repo.events.byClient(client.id)))
  }
  allEvents.sort((a, b) => a.timestampMs - b.timestampMs)
  log("engine", `${allEvents.length} persisted door events; replaying the window`)

  // Unobservable scenarios: the device drops mid-visit, so the visit flips to
  // unobservable when the offline event arrives (reason per the demo plan).
  const offlineFlip = new Map<string, { visitId: string; reason: ObservabilityReason }>()
  for (const plan of replay.visits) {
    if (plan.kind !== "unobservable") continue
    offlineFlip.set(`${plan.clientId}:${plan.scheduledStartAt + 30 * MIN}`, {
      visitId: visitIdByPlan.get(`${plan.clientId}:${plan.scheduledStartAt}`)!,
      reason: CLIENT_INFO[plan.clientId]!.unobservableReason,
    })
  }

  const applyDelta = async (
    result: { toRaise: Exception[]; toResolveIds: string[] },
    now: Date,
  ): Promise<void> => {
    for (const exception of result.toRaise) await repo.exceptions.put(exception)
    // raiseExceptions only returns system-owned kinds (late_no_arrival) in
    // toResolveIds; human cards stay open until resolved in the console.
    for (const id of result.toResolveIds) {
      const exception = await repo.exceptions.get(AGENCY_ID, id)
      if (!exception || exception.state !== "open") continue
      await repo.exceptions.put({
        ...exception,
        state: "resolved",
        resolution: systemResolution(now, "superseded"),
        updatedAt: now.toISOString(),
        version: exception.version + 1,
      })
    }
  }

  // Writes are change-only: the local store rewrites a whole JSON table per
  // put, so unconditional saves of 84 visits across ~1,300 sweep ticks would
  // be gigabytes of redundant IO.
  const visitSnapshot = new Map<string, string>()
  const putVisitIfChanged = async (visit: Visit): Promise<void> => {
    const serialized = JSON.stringify(visit)
    if (visitSnapshot.get(visit.id) === serialized) return
    visitSnapshot.set(visit.id, serialized)
    await repo.visits.put(visit)
  }
  for (const client of clients) {
    for (const visit of await repo.visits.byClient(client.id)) {
      visitSnapshot.set(visit.id, JSON.stringify(visit))
    }
  }

  const finalNow = replay.endAt + 75 * MIN
  let cursor = 0
  const eventsSoFar: DoorEvent[] = []
  for (let tick = startAt; tick <= finalNow; tick += 15 * MIN) {
    while (cursor < allEvents.length && allEvents[cursor]!.timestampMs <= tick) {
      const event = allEvents[cursor]!
      cursor += 1
      eventsSoFar.push(event)
      const eventTime = new Date(event.timestampMs + 1_000)
      const flip = offlineFlip.get(`${event.clientId}:${event.timestampMs}`)
      if (flip && event.type === "device_offline") {
        const visit = await repo.visits.get(event.clientId, flip.visitId)
        if (visit) {
          await putVisitIfChanged({
            ...visit,
            observability: { state: "unobservable", reasons: [flip.reason] },
            updatedAt: eventTime.toISOString(),
            version: visit.version + 1,
          })
        }
      }
      const result = processEvent({
        event,
        events: eventsSoFar.filter((candidate) => candidate.clientId === event.clientId),
        visits: await repo.visits.byClient(event.clientId),
        openExceptions: await repo.exceptions.byAgency(AGENCY_ID, "open"),
        tolerances: TOLERANCES,
        now: eventTime,
      })
      if (result.matched && result.visit) await putVisitIfChanged(result.visit)
      await applyDelta(result, eventTime)
    }
    const visitsNow: Visit[] = []
    for (const client of clients) visitsNow.push(...(await repo.visits.byClient(client.id)))
    const swept = sweepVisits({
      visits: visitsNow,
      events: eventsSoFar,
      openExceptions: await repo.exceptions.byAgency(AGENCY_ID, "open"),
      tolerances: TOLERANCES,
      now: new Date(tick),
    })
    for (const visit of swept.visits) await putVisitIfChanged(visit)
    await applyDelta(swept, new Date(tick))
  }
  log("engine", "replay complete; visit statuses and exception cards are final")

  // -- 4. EVV clock-ins, reconciliation, narratives --------------------------
  const allVisits: Visit[] = []
  for (const client of clients) {
    allVisits.push(...(await repo.visits.byClient(client.id)))
  }
  allVisits.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))

  const evvByClient = new Map<string, EVVRecord[]>()
  const eligible = allVisits.filter(
    (visit) => visit.arrival && visit.observability.state !== "unobservable",
  )
  const contradictedIds = new Set(eligible.slice(0, 6).map((visit) => visit.id))
  const missingIds = new Set(eligible.slice(6, 14).map((visit) => visit.id))
  let evvCount = 0
  for (const visit of eligible) {
    if (missingIds.has(visit.id)) continue
    const caregiver = CAREGIVERS[visit.caregiverId]!
    const clockIn = contradictedIds.has(visit.id)
      ? new Date(Date.parse(visit.arrival!.at) + 40 * MIN).toISOString()
      : visit.arrival!.at
    const record: EVVRecord = {
      ...audit(clockIn),
      id: `evv_${visit.id}`,
      clientId: visit.clientId,
      agencyId: AGENCY_ID,
      caregiverEvvId: caregiver.evvEmployeeId,
      serviceCode: visit.serviceCode,
      clockIn,
      ...(visit.departure ? { clockOut: visit.departure.at } : {}),
      verificationMethod: "mobile GPS",
      source: "csv",
      visitId: visit.id,
    }
    await repo.evvRecords.put(record)
    evvByClient.set(visit.clientId, [...(evvByClient.get(visit.clientId) ?? []), record])
    evvCount += 1
  }

  for (const visit of allVisits) {
    const reconciliation = reconcile({
      visit,
      evvRecords: evvByClient.get(visit.clientId) ?? [],
      tolerances: TOLERANCES,
    })
    const narrative = buildNarrative({
      visit,
      caregiverName: CAREGIVERS[visit.caregiverId]?.name,
      now: new Date(),
    })
    await repo.visits.put({
      ...visit,
      reconciliation,
      narrative,
      updatedAt: new Date().toISOString(),
      version: visit.version + 1,
    })
  }
  log(
    "evv",
    `${evvCount} clock-ins seeded (${contradictedIds.size} contradicting, ${missingIds.size} missing); reconciliation stored on every visit`,
  )

  // One caregiver note so the Reported column and the caregiver page have content.
  const notedVisit = allVisits.find((visit) => visit.status !== "scheduled" && visit.arrival)
  const notes: Note[] = []
  if (notedVisit) {
    const lateVisit = allVisits.find(
      (visit) =>
        visit.arrival &&
        Date.parse(visit.arrival.at) >
          Date.parse(visit.scheduledStart) + TOLERANCES.graceMin * MIN,
    )
    const target = lateVisit ?? notedVisit
    const note: Note = {
      ...audit(new Date().toISOString()),
      id: "note_caregiver_roadwork",
      visitId: target.id,
      authorRole: "caregiver",
      authorId: target.caregiverId,
      at: new Date(Date.parse(target.arrival!.at) + 5 * MIN).toISOString(),
      text: "I was delayed by road work and arrived as soon as I could.",
      classification: "explanation",
      confidence: 0.82,
    }
    await repo.evidence.putNote(note)
    notes.push(note)
  }

  // -- 5. Signed evidence ledger (per-client hash chains) --------------------
  let ledgerCount = 0
  const allExceptions = await repo.exceptions.byAgency(AGENCY_ID)
  for (const client of clients) {
    const entries: { at: string; column: "observed" | "reported" | "resolved"; subject: string; payload: unknown }[] = []
    for (const visit of allVisits.filter((candidate) => candidate.clientId === client.id)) {
      entries.push({
        at: visit.departure?.at ?? visit.arrival?.at ?? visit.scheduledEnd,
        column: "observed",
        subject: visit.id,
        payload: {
          status: visit.status,
          arrival: visit.arrival?.at ?? null,
          departure: visit.departure?.at ?? null,
          observability: visit.observability.state,
        },
      })
    }
    for (const record of evvByClient.get(client.id) ?? []) {
      entries.push({
        at: record.clockIn,
        column: "reported",
        subject: record.id,
        payload: { clockIn: record.clockIn, clockOut: record.clockOut ?? null },
      })
    }
    for (const note of notes) {
      const visit = allVisits.find((candidate) => candidate.id === note.visitId)
      if (visit?.clientId === client.id) {
        entries.push({ at: note.at, column: "reported", subject: note.id, payload: { text: note.text } })
      }
    }
    for (const exception of allExceptions.filter(
      (candidate) => candidate.clientId === client.id && candidate.resolution,
    )) {
      entries.push({
        at: exception.resolution!.at,
        column: "resolved",
        subject: exception.id,
        payload: { kind: exception.kind, reason: exception.resolution!.reason },
      })
    }
    entries.sort((a, b) => a.at.localeCompare(b.at))
    let seq = 0
    let prev: Awaited<ReturnType<typeof repo.evidence.ledgerByClient>>[number] | undefined
    for (const entry of entries) {
      seq += 1
      const record = signLedger({
        clientId: client.id,
        seq,
        column: entry.column,
        subject: entry.subject,
        payload: entry.payload,
        signerKeyId: LEDGER_SIGNER.keyId,
        at: entry.at,
        ...(prev ? { prev } : {}),
        sign,
      })
      await repo.evidence.appendLedger(record)
      prev = record
      ledgerCount += 1
    }
  }

  // -- 6. Summary + console ---------------------------------------------------
  const countBy = <T,>(items: readonly T[], key: (item: T) => string): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const item of items) counts[key(item)] = (counts[key(item)] ?? 0) + 1
    return counts
  }
  const finalVisits: Visit[] = []
  for (const client of clients) finalVisits.push(...(await repo.visits.byClient(client.id)))
  const openExceptions = await repo.exceptions.byAgency(AGENCY_ID, "open")
  const summary = {
    deliveries: { accepted, duplicates, total: replay.deliveries.length },
    visits: countBy(finalVisits, (visit) => visit.status),
    lateArrivals: finalVisits.filter(
      (visit) =>
        visit.arrival &&
        Date.parse(visit.arrival.at) > Date.parse(visit.scheduledStart) + TOLERANCES.graceMin * MIN,
    ).length,
    exceptionsOpen: countBy(openExceptions, (exception) => exception.kind),
    reconciliation: countBy(
      finalVisits.map((visit) => visit.reconciliation?.outcome ?? "pending"),
      (outcome) => outcome,
    ),
    evvRecords: evvCount,
    ledgerRecords: ledgerCount,
  }
  log("summary", JSON.stringify(summary, null, 2))

  runService(
    "console",
    ["--filter", "@visitproof/console", "exec", "next", "dev", "-p", String(CONSOLE_PORT)],
    { VISITPROOF_DEMO_STORE_PATH: STORE_DIR, NEXT_TELEMETRY_DISABLED: "1" },
  )
  await waitFor(`http://localhost:${CONSOLE_PORT}`, 180_000)

  process.stdout.write(
    [
      "",
      "VisitProof demo is ready.",
      `  Console:  http://localhost:${CONSOLE_PORT}`,
      `  Webhooks: http://localhost:${WEBHOOK_PORT}/health (signed receiver, same store)`,
      "",
      "Sign in with one click as: Scheduler (Today board + exception cards),",
      "Compliance Lead (reconciliation, evidence pack PDF, EVV JSON export),",
      "Family Member (Grace Okoro's feed), or Caregiver (own visit record).",
      "",
      "Ctrl+C stops both services. The seeded store lives in .demo-data/.",
      "",
    ].join("\n"),
  )
  await new Promise(() => {})
}

const shutdown = (): void => {
  for (const child of children) child.kill("SIGTERM")
  process.exit(0)
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

main().catch((error) => {
  console.error("[demo] failed:", error)
  shutdown()
  process.exit(1)
})
