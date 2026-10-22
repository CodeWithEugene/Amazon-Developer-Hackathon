/**
 * Ring Playground smoke test: proves the SDK against the live Ring Partner
 * API with a 30 minute Playground token (docs/research.md Section 2.4).
 *
 *   pnpm ring:smoke                 reads RING_PLAYGROUND_ACCESS_TOKEN from .env or the shell
 *   pnpm ring:smoke -- --no-write   skips writing fixtures
 *
 * Calls me, devices (with status, capabilities, configurations, location),
 * then status, capabilities, configurations, location, and one history page
 * for the first shared device. Prints a readable report with provenance and
 * writes REDACTED responses to packages/ring-partner-sdk/src/fixtures/playground/
 * (first_name, last_name, email, phone_number, and every token stripped).
 * The token is read from the environment only and is never printed.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import {
  DEFAULT_RING_API_BASE,
  RingApiError,
  RingClient,
  redactFixture,
} from "@visitproof/ring-partner-sdk"

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/ring-partner-sdk/src/fixtures/playground"
)
const PROVENANCE = "Ring Playground sandbox device"

interface StepResult {
  readonly name: string
  readonly ok: boolean
  readonly summary: string
  readonly body?: unknown
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

const step = async <T>(
  name: string,
  call: () => Promise<T>,
  summarize: (body: T) => string
): Promise<StepResult> => {
  try {
    const body = await call()
    return { name, ok: true, summary: summarize(body), body }
  } catch (error) {
    return { name, ok: false, summary: describeError(error) }
  }
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

const deviceSteps = async (ring: RingClient, deviceId: string): Promise<StepResult[]> => [
  await step("status", () => ring.deviceStatus(deviceId), (doc) => `online ${doc.data.attributes.online}, encryption ${doc.data.attributes.encryption_state ?? "not reported"}`),
  await step("capabilities", () => ring.deviceCapabilities(deviceId), (doc) => `human detection ${doc.data.attributes.human_detection ?? "not reported"}, live view ${doc.data.attributes.live_view ?? "not reported"}`),
  await step("configurations", () => ring.deviceConfigurations(deviceId), (doc) => `motion recording ${doc.data.attributes.motion_recording_enabled ?? "not reported"}, ${count(doc.data.attributes.motion_zones)} motion zones`),
  await step("location", () => ring.deviceLocation(deviceId), (doc) => `${doc.data.attributes.country}${doc.data.attributes.state ? ` ${doc.data.attributes.state}` : ""}`),
  await step("history-page", () => ring.historyEvents(deviceId), (page) => `${page.events.length} events on the first page, types ${[...new Set(page.events.map((e) => e.attributes.event_type))].join(", ") || "none"}, next page ${page.nextUrl ? "yes" : "no"}`),
]

const run = async (ring: RingClient): Promise<StepResult[]> => {
  const me = await step("me", () => ring.me(), (doc) => `user ${doc.data.id}`)
  const devices = await step(
    "devices",
    () => ring.devices({ include: ["status", "capabilities", "configurations", "location"] }),
    (doc) => `${doc.data.length} shared devices: ${doc.data.map((d) => d.attributes.name).join(", ") || "none"}`
  )
  const first = devices.ok ? (devices.body as Awaited<ReturnType<RingClient["devices"]>>).data[0] : undefined
  if (!first) return [me, devices]
  return [me, devices, ...(await deviceSteps(ring, first.id))]
}

const writeFixtures = async (results: readonly StepResult[], apiBase: string): Promise<void> => {
  await mkdir(FIXTURE_DIR, { recursive: true })
  const recorded = results.filter((result) => result.ok)
  for (const result of recorded) {
    const body = result.name === "history-page" ? (result.body as { document: unknown }).document : result.body
    await writeFile(join(FIXTURE_DIR, `${result.name}.json`), `${JSON.stringify(redactFixture(body), null, 2)}\n`)
  }
  const manifest = {
    provenance: PROVENANCE,
    source: "Ring Developer Playground (live Ring Partner API)",
    apiBase,
    recordedAt: new Date().toISOString(),
    redacted: ["first_name", "last_name", "email", "phone_number", "tokens"],
    files: recorded.map((result) => `${result.name}.json`),
  }
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
  for (const result of results) out(`  ${result.ok ? "PASS" : "FAIL"}  ${result.name.padEnd(15)} ${result.summary}`)
  const anyPassed = results.some((result) => result.ok)
  if (process.argv.includes("--no-write")) {
    out("Fixtures not written (--no-write).")
  } else if (!anyPassed) {
    out("No call succeeded, so no fixtures were written.")
  } else {
    await writeFixtures(results, apiBase)
    out(`Redacted fixtures written to ${FIXTURE_DIR}`)
  }
  return results.every((result) => result.ok) ? 0 : 1
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
