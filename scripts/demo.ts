/**
 * Entry point for `pnpm demo`; the steps live in scripts/demo/. Ctrl+C (or
 * a service exiting) stops every service this demo started and releases the
 * store lock.
 */
import { DemoError } from "./demo/log"
import { runDemo } from "./demo/main"
import { stopServices } from "./demo/processes"
import type { StoreLock } from "./demo/store-guard"

let lock: StoreLock | null = null

async function shutdown(code: number): Promise<never> {
  stopServices()
  if (lock) await lock.release()
  process.exit(code)
}

process.on("SIGINT", () => void shutdown(0))
process.on("SIGTERM", () => void shutdown(0))

runDemo((acquired) => {
  lock = acquired
})
  .then((exited) => {
    process.stderr.write(
      `[demo] ${exited} stopped; shutting down the other services\n`
    )
    return shutdown(1)
  })
  .catch((error: unknown) => {
    const message =
      error instanceof DemoError
        ? error.message
        : error instanceof Error
          ? (error.stack ?? error.message)
          : String(error)
    process.stderr.write(`[demo] failed: ${message}\n`)
    return shutdown(1)
  })
