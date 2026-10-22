/**
 * Starts `pnpm demo` on the recorder's isolated ports (3240 console, 3241
 * webhooks, 3242 MCP) with its own store, waits until it is ready, and stops
 * exactly the process group it started.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { createWriteStream } from "node:fs"
import { connect } from "node:net"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)))
export const PORTS = { console: 3240, webhook: 3241, mcp: 3242 } as const
export const BASE_URL = `http://localhost:${PORTS.console}`
const STORE_PATH = "/private/tmp/vp-video-store"
const TIME_ZONE = "America/New_York"
const READY_LINE = "VisitProof demo is ready"
const READY_TIMEOUT_MS = 6 * 60_000
const STOP_TIMEOUT_MS = 20_000

export interface DemoServer {
  readonly pid: number
  stop(): Promise<void>
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** True when something accepts TCP connections on `port`. */
export function isListening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ host: "127.0.0.1", port })
    socket.setTimeout(1000)
    socket.once("connect", () => {
      socket.destroy()
      done(true)
    })
    socket.once("timeout", () => {
      socket.destroy()
      done(false)
    })
    socket.once("error", () => done(false))
  })
}

async function busyPorts(): Promise<number[]> {
  const ports = Object.values(PORTS)
  const states = await Promise.all(ports.map((port) => isListening(port)))
  return ports.filter((_, index) => states[index])
}

async function consoleAnswers(): Promise<boolean> {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(20_000) })
    return response.status === 200
  } catch {
    return false
  }
}

/**
 * Environment for the demo. Offline mode skips the repository .env; live
 * mode passes RING_PLAYGROUND_ACCESS_TOKEN through explicitly from the
 * recorder's own environment (the .env file is still never read).
 */
function demoEnv(liveToken: string | undefined, clockOffsetMs: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(PORTS.console),
    WEBHOOK_PORT: String(PORTS.webhook),
    MCP_PORT: String(PORTS.mcp),
    VISITPROOF_DEMO_STORE_PATH: STORE_PATH,
    VISITPROOF_DEMO_DOTENV: "0",
  }
  if (liveToken) env.RING_PLAYGROUND_ACCESS_TOKEN = liveToken
  else delete env.RING_PLAYGROUND_ACCESS_TOKEN
  if (clockOffsetMs !== 0) {
    env.VP_VIDEO_CLOCK_OFFSET_MS = String(Math.round(clockOffsetMs))
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, `--require=${CLOCK_SHIFT}`].filter(Boolean).join(" ")
  }
  return env
}

const CLOCK_SHIFT = fileURLToPath(new URL("./clock-shift.cjs", import.meta.url))
/** Simulated "now" for the offline cut: this evening, after every replayed visit has settled. */
const EVENING = { hour: 21, minute: 50 }

/** Milliseconds from the wall clock to EVENING today in the agency time zone. */
export function eveningClockOffset(nowMs: number = Date.now()): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(nowMs))
      .map((part) => [part.type, Number(part.value)])
  ) as Record<string, number>
  const localAsUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!)
  const zoneOffset = localAsUtc - Math.floor(nowMs / 1000) * 1000
  const target = Date.UTC(parts.year!, parts.month! - 1, parts.day!, EVENING.hour, EVENING.minute) - zoneOffset
  return target - nowMs
}

function stopGroup(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  const exited = new Promise<void>((done) => child.once("exit", () => done()))
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
  signal("SIGTERM")
  return Promise.race([exited, sleep(STOP_TIMEOUT_MS).then(() => signal("SIGKILL"))]).then(() => undefined)
}

export async function startDemo(
  logPath: string,
  liveToken: string | undefined,
  clockOffsetMs = 0
): Promise<DemoServer> {
  const busy = await busyPorts()
  if (busy.length > 0) {
    throw new Error(`ports ${busy.join(", ")} are already in use; stop whatever is listening there first`)
  }
  const log = createWriteStream(logPath)
  const child = spawn("pnpm", ["demo"], {
    cwd: ROOT,
    env: demoEnv(liveToken, clockOffsetMs),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  if (child.pid === undefined) throw new Error("pnpm demo did not start")
  let sawReady = false
  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk)
    if (chunk.toString("utf8").includes(READY_LINE)) sawReady = true
  })
  child.stderr?.on("data", (chunk: Buffer) => log.write(chunk))
  const server: DemoServer = {
    pid: child.pid,
    stop: async () => {
      await stopGroup(child)
      log.end()
    },
  }
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (!sawReady && !(await consoleAnswers())) {
    if (child.exitCode !== null) {
      await server.stop()
      throw new Error(`pnpm demo exited early with code ${child.exitCode}; see ${logPath}`)
    }
    if (Date.now() > deadline) {
      await server.stop()
      throw new Error(`pnpm demo was not ready after ${READY_TIMEOUT_MS / 1000} s; see ${logPath}`)
    }
    await sleep(1000)
  }
  return server
}

/** Waits until nothing listens on the recorder's ports, and lists any that still do. */
export async function portsStillBusy(): Promise<number[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const busy = await busyPorts()
    if (busy.length === 0) return []
    await sleep(500)
  }
  return busyPorts()
}
