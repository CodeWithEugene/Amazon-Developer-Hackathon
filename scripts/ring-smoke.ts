/**
 * Ring Playground smoke test: proves the SDK against the live Ring Partner
 * API with a 30 minute Playground token (docs/research.md Section 2.4).
 *
 *   pnpm ring:smoke                 reads RING_PLAYGROUND_ACCESS_TOKEN from .env or the shell
 *   pnpm ring:smoke -- --no-write   skips writing fixtures
 *
 * Calls me, devices (with status, capabilities, configurations, location),
 * then status, capabilities, configurations, location, one history page, and
 * subscriptions. Prints PASS, INFO, or FAIL per call with provenance, then
 * the Device Check summary for each shared device. An empty history page is
 * a PASS ("0 events": the Playground doorbell has no recorded events), and a
 * 422 on subscriptions is INFO (not available for Playground users).
 * Writes REDACTED bodies to packages/ring-partner-sdk/src/fixtures/playground/
 * and merges manifest.json (files, request paths, status codes). The token
 * is read from the environment only and is never printed.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_RING_API_BASE,
  ENDPOINTS,
  isNotAvailableForAccount,
  RingApiError,
  RingClient,
  redactFixture,
  type DeviceListDocument,
} from "@visitproof/ring-partner-sdk"
import { z } from "zod"

import { buildDeviceChecks, deviceCheckSummary } from "../apps/console/lib/ring/device-check"

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../packages/ring-partner-sdk/src/fixtures/playground")
const PROVENANCE = "Ring Playground sandbox device"
const DEVICES_PATH = `${ENDPOINTS.devices}?include=status,capabilities,configurations,location`

type Level = "PASS" | "INFO" | "FAIL"

interface CapturedRequest {
  readonly method: string
  readonly path: string
  readonly status: number
}

interface Fixture {
  readonly file: string
  readonly request: CapturedRequest
  readonly body: unknown
}

interface StepResult {
  readonly name: string
  readonly level: Level
  readonly summary: string
  readonly body?: unknown
  readonly fixture?: Fixture
}

interface StepSpec<T> {
  readonly name: string
  /** Fixture file and request path recorded on success. */
  readonly file: string
  readonly path: string
  readonly call: () => Promise<T>
  readonly summarize: (body: T) => string
  /** The body to record (defaults to the call result). */
  readonly record?: (body: T) => unknown
}

const out = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

const describeError = (error: unknown): string => {
  if (error instanceof RingApiError) {
    const hint = error.status === 401 ? " (Playground tokens last about 30 minutes; mint a new one)" : ""
    return `${error.name} HTTP ${error.status}${error.code ? ` ${error.code}` : ""}${hint}`
  }
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

/** A typed "not available for this account" answer is INFO, with its error body kept as a fixture. */
const infoFor = (name: string, file: string, path: string, error: unknown): StepResult | undefined => {
  if (!isNotAvailableForAccount(error)) return undefined
  const detail = error.document?.errors[0]?.detail
  return {
    name,
    level: "INFO",
    summary: `not available for this account (HTTP ${error.status}${detail ? `: ${detail}` : ""})`,
    fixture: { file: file.replace(/\.json$/, `-${error.status}.json`), request: { method: "GET", path, status: error.status }, body: error.document },
  }
}

const step = async <T>(spec: StepSpec<T>): Promise<StepResult> => {
  try {
    const body = await spec.call()
    const fixture: Fixture = {
      file: spec.file,
      request: { method: "GET", path: spec.path, status: 200 },
      body: spec.record ? spec.record(body) : body,
    }
    return { name: spec.name, level: "PASS", summary: spec.summarize(body), body, fixture }
  } catch (error) {
    return infoFor(spec.name, spec.file, spec.path, error) ?? { name: spec.name, level: "FAIL", summary: describeError(error) }
  }
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

const historySummary = (events: readonly { attributes: { event_type: string } }[], hasNext: boolean): string => {
  if (events.length === 0) return "0 events (Ring returned no events for this device since consent)"
  const types = [...new Set(events.map((event) => event.attributes.event_type))].join(", ")
  return `${events.length} events on the first page, types ${types}, next page ${hasNext ? "yes" : "no"}`
}

const deviceSteps = async (ring: RingClient, id: string): Promise<StepResult[]> => [
  await step({ name: "status", file: "status.json", path: ENDPOINTS.deviceStatus(id), call: () => ring.deviceStatus(id), summarize: (doc) => `online ${doc.data.attributes.online}, reported ${doc.data.attributes.reported_at ?? "not reported"}` }),
  await step({ name: "capabilities", file: "capabilities.json", path: ENDPOINTS.deviceCapabilities(id), call: () => ring.deviceCapabilities(id), summarize: (doc) => `motion ${doc.data.attributes.motion_detection?.configurations?.join(", ") ?? "not reported"}, codecs ${doc.data.attributes.video?.codecs?.join(", ") ?? "not reported"}` }),
  await step({ name: "configurations", file: "configurations.json", path: ENDPOINTS.deviceConfigurations(id), call: () => ring.deviceConfigurations(id), summarize: (doc) => `motion ${doc.data.attributes.motion_detection?.enabled ?? "not reported"}, ${count(doc.data.attributes.motion_detection?.motion_zones)} motion zones, end to end encryption ${doc.data.attributes.e2e_encryption?.enabled ?? "not reported"}` }),
  await step({ name: "location", file: "location.json", path: ENDPOINTS.deviceLocation(id), call: () => ring.deviceLocation(id), summarize: (doc) => `${doc.data.attributes.country}${doc.data.attributes.state ? ` ${doc.data.attributes.state}` : ""}` }),
  await step({ name: "history", file: "history.json", path: ENDPOINTS.historyEvents(id), call: () => ring.historyEvents(id), summarize: (page) => historySummary(page.events, Boolean(page.nextUrl)), record: (page) => page.document }),
]

const run = async (ring: RingClient): Promise<StepResult[]> => {
  const me = await step({ name: "me", file: "me.json", path: ENDPOINTS.me, call: () => ring.me(), summarize: (doc) => (doc.data.id ? "user id present (redacted)" : "no user id") })
  const devices = await step({
    name: "devices",
    file: "devices.json",
    path: DEVICES_PATH,
    call: () => ring.devices({ include: ["status", "capabilities", "configurations", "location"] }),
    summarize: (doc) => `${doc.data.length} shared devices: ${doc.data.map((d) => d.attributes.name).join(", ") || "none"}`,
  })
  const subscriptions = await step({ name: "subscriptions", file: "subscriptions.json", path: ENDPOINTS.subscriptions, call: () => ring.subscriptions(), summarize: (doc) => `${doc.data.length} subscriptions` })
  const first = devices.level === "PASS" ? (devices.body as DeviceListDocument).data[0] : undefined
  const perDevice = first ? await deviceSteps(ring, first.id) : []
  return [me, devices, ...perDevice, subscriptions]
}

const printDeviceChecks = (results: readonly StepResult[]): void => {
  const devices = results.find((result) => result.name === "devices" && result.level === "PASS")
  if (!devices) return out("Device Check skipped: the devices call did not pass.")
  for (const check of buildDeviceChecks(devices.body as DeviceListDocument)) {
    out(`Device Check for ${check.name}: ${deviceCheckSummary(check)}`)
    for (const item of check.items) out(`  ${item.state.toUpperCase().padEnd(7)} ${item.title}: ${item.observed}`)
  }
}

const manifestSchema = z.looseObject({
  deviceId: z.string().optional(),
  requests: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
})
type Manifest = z.infer<typeof manifestSchema>

const readManifest = async (): Promise<Manifest> => {
  try {
    return manifestSchema.parse(JSON.parse(await readFile(join(FIXTURE_DIR, "manifest.json"), "utf8")))
  } catch {
    return {}
  }
}

/** Merges per file, so extra notes on a request (for example alsoVerified) survive a rerun. */
const buildManifest = (previous: Manifest, fixtures: readonly Fixture[], apiBase: string, deviceId: string | undefined) => {
  const updates = Object.fromEntries(fixtures.map((fixture) => [fixture.file, { ...previous.requests?.[fixture.file], ...fixture.request }]))
  const requests = { ...previous.requests, ...updates }
  const recordedAt = new Date().toISOString()
  return {
    provenance: PROVENANCE,
    source: "Ring Developer Playground (live Ring Partner API)",
    apiBase,
    recordedAt,
    capturedAt: recordedAt,
    notes: "Written by pnpm ring:smoke at recordedAt. Files the smoke test did not call in that run are kept from earlier captures. Bodies only; no tokens or personal data.",
    deviceId: deviceId ?? previous.deviceId,
    redacted: ["first_name", "last_name", "email", "phone_number", "tokens"],
    files: Object.keys(requests),
    requests,
  }
}

const firstDeviceId = (results: readonly StepResult[]): string | undefined => {
  const devices = results.find((result) => result.name === "devices" && result.level === "PASS")
  return devices ? (devices.body as DeviceListDocument).data[0]?.id : undefined
}

/** Writes redacted bodies and merges the manifest so files from earlier captures stay listed. */
const writeFixtures = async (results: readonly StepResult[], apiBase: string): Promise<void> => {
  await mkdir(FIXTURE_DIR, { recursive: true })
  const fixtures = results.flatMap((result) => (result.fixture ? [result.fixture] : []))
  for (const fixture of fixtures) {
    await writeFile(join(FIXTURE_DIR, fixture.file), `${JSON.stringify(redactFixture(fixture.body), null, 2)}\n`)
  }
  const manifest = buildManifest(await readManifest(), fixtures, apiBase, firstDeviceId(results))
  await writeFile(join(FIXTURE_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
}

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), "../.env")

/** Loads the repository's .env when present; values already exported in the shell win. */
const loadDotEnv = (): void => {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
}

const report = async (results: readonly StepResult[], apiBase: string): Promise<void> => {
  for (const result of results) out(`  ${result.level}  ${result.name.padEnd(15)} ${result.summary}`)
  printDeviceChecks(results)
  if (process.argv.includes("--no-write")) return out("Fixtures not written (--no-write).")
  if (!results.some((result) => result.level === "PASS")) return out("No call succeeded, so no fixtures were written.")
  await writeFixtures(results, apiBase)
  out(`Redacted fixtures written to ${FIXTURE_DIR}`)
}

const main = async (): Promise<number> => {
  loadDotEnv()
  const token = process.env.RING_PLAYGROUND_ACCESS_TOKEN?.trim()
  if (!token) {
    out("RING_PLAYGROUND_ACCESS_TOKEN is not set. Mint a token in the Ring Developer Playground and put it in .env (or export it) first.")
    return 2
  }
  const apiBase = process.env.RING_API_BASE?.trim() || DEFAULT_RING_API_BASE
  const ring = new RingClient({ baseUrl: apiBase, getAccessToken: () => token })
  out(`Ring smoke test against ${apiBase} (provenance: ${PROVENANCE})`)
  const results = await run(ring)
  await report(results, apiBase)
  return results.some((result) => result.level === "FAIL") ? 1 : 0
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    out(`Smoke test crashed: ${describeError(error)}`)
    process.exitCode = 1
  }
)
