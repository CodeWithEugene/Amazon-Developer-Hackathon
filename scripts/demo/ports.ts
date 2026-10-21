/**
 * Port preflight: every port the demo will serve on is bind-tested before
 * the store is touched, so a stale server can never answer the demo's
 * health checks or receive its webhooks. A taken port is reported with the
 * process holding it (from lsof when available).
 */
import { execFile } from "node:child_process"
import { createServer } from "node:net"
import { promisify } from "node:util"

import { DemoError } from "./log"

const run = promisify(execFile)

export interface PortClaim {
  readonly name: string
  readonly port: number
}

type BindResult = "free" | "in_use" | "unsupported"

/** Try to listen on `host:port` and close again at once. */
export function bindTest(port: number, host: string): Promise<BindResult> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES")
        resolve("in_use")
      else if (error.code === "EAFNOSUPPORT" || error.code === "EADDRNOTAVAIL")
        resolve("unsupported")
      else reject(error)
    })
    server.listen({ port, host, exclusive: true }, () => {
      server.close((error) => (error ? reject(error) : resolve("free")))
    })
  })
}

/** Free on IPv4 loopback and on the wildcard address (what Next and Hono bind). */
export async function isPortFree(port: number): Promise<boolean> {
  for (const host of ["127.0.0.1", "::", "0.0.0.0"]) {
    if ((await bindTest(port, host)) === "in_use") return false
  }
  return true
}

/** "node (pid 4242)" from lsof, or null when lsof is unavailable. */
export async function describeListener(port: number): Promise<string | null> {
  try {
    const { stdout } = await run("lsof", [
      "-nP",
      `-iTCP:${port}`,
      "-sTCP:LISTEN",
      "-Fpc",
    ])
    const pid = /^p(\d+)$/m.exec(stdout)?.[1]
    const command = /^c(.+)$/m.exec(stdout)?.[1]
    return pid ? `${command ?? "unknown"} (pid ${pid})` : null
  } catch (error) {
    // lsof exits 1 when nothing matches, and may be missing entirely.
    if (typeof error === "object" && error !== null && "code" in error)
      return null
    throw error
  }
}

/** Throws a DemoError naming every taken port and its process. */
export async function preflightPorts(
  claims: readonly PortClaim[]
): Promise<void> {
  const taken: string[] = []
  for (const claim of claims) {
    if (await isPortFree(claim.port)) continue
    const holder = await describeListener(claim.port)
    taken.push(
      `  ${claim.name} port ${claim.port} is in use${holder ? ` by ${holder}` : ""}`
    )
  }
  if (taken.length === 0) return
  throw new DemoError(
    [
      "these ports are already taken, so the demo did not start and the store was not touched:",
      ...taken,
      "Stop that process, or choose other ports, for example:",
      "  PORT=3200 WEBHOOK_PORT=3201 MCP_PORT=3202 VISITPROOF_DEMO_STORE_PATH=/tmp/vp-demo pnpm demo",
    ].join("\n")
  )
}
