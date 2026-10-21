/**
 * Child services of the demo (webhooks, MCP server, console). Each is
 * started with pnpm in the repository root, its output is prefixed, and
 * readiness is confirmed by the service's own health response, so a
 * different server on the same port can never pass for it.
 */
import { spawn, type ChildProcess } from "node:child_process"

import { DemoError } from "./log"

export interface Service {
  readonly name: string
  readonly child: ChildProcess
  exited(): boolean
}

const POLL_MS = 400
const children: Service[] = []

export function startService(
  name: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd: string
): Service {
  const child = spawn("pnpm", [...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    // Own process group, so stopping the service also stops the server
    // pnpm started for it (next dev, tsx).
    detached: true,
  })
  let done = false
  child.once("exit", () => {
    done = true
  })
  child.stdout?.on("data", (chunk: Buffer) =>
    process.stdout.write(prefix(name, chunk))
  )
  child.stderr?.on("data", (chunk: Buffer) =>
    process.stderr.write(prefix(name, chunk))
  )
  const service = { name, child, exited: () => done }
  children.push(service)
  return service
}

const prefix = (name: string, chunk: Buffer): string =>
  chunk
    .toString("utf8")
    .split("\n")
    .map((line, index, lines) =>
      index === lines.length - 1 && line === "" ? "" : `[${name}] ${line}`
    )
    .join("\n")

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export type ReadyCheck = (response: Response) => Promise<boolean>

/** Health endpoints answer JSON with the service name (webhooks, mcp). */
export const serviceNamed =
  (expected: string): ReadyCheck =>
  async (response) => {
    if (!response.ok) return false
    const body: unknown = await response.json()
    return (
      typeof body === "object" &&
      body !== null &&
      (body as { service?: unknown }).service === expected
    )
  }

/** Any HTTP answer counts (the console's first compile can take a while). */
export const anyResponse: ReadyCheck = async () => true

const isConnectionError = (error: unknown): boolean =>
  error instanceof TypeError ||
  (error instanceof Error &&
    /ECONNREFUSED|ECONNRESET|fetch failed/.test(error.message))

/** Polls `url` until `ready` passes, the service exits, or time runs out. */
export async function waitForService(
  service: Service,
  url: string,
  ready: ReadyCheck,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (service.exited())
      throw new DemoError(
        `${service.name} exited before it was ready (see its output above)`
      )
    try {
      if (
        await ready(await fetch(url, { signal: AbortSignal.timeout(30_000) }))
      )
        return
    } catch (error) {
      if (!isConnectionError(error) && !(error instanceof SyntaxError))
        throw error
    }
    if (Date.now() > deadline)
      throw new DemoError(`timed out waiting for ${service.name} at ${url}`)
    await sleep(POLL_MS)
  }
}

const killGroup = (service: Service): void => {
  const pid = service.child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, "SIGTERM")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

/** Stops every child the demo started (and only those), by process group. */
export function stopServices(): void {
  for (const service of children) killGroup(service)
}

/** Pids of the services' process groups (for the ready banner). */
export const servicePids = (): Readonly<Record<string, number | undefined>> =>
  Object.fromEntries(
    children.map((service) => [service.name, service.child.pid])
  )

/** Resolves when any service exits (the demo then shuts down). */
export function anyServiceExit(): Promise<string> {
  return new Promise((resolve) => {
    for (const service of children)
      service.child.once("exit", () => resolve(service.name))
  })
}
