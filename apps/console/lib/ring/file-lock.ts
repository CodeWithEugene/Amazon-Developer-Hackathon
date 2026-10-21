import { mkdir, rm, stat } from "node:fs/promises"

/**
 * Cross-process mutex on a directory (mkdir is atomic). Several processes
 * (console, webhooks, demo script) may touch the token file at once
 * (contract C8). A lock older than `staleMs` is considered abandoned.
 */

export interface FileLockOptions {
  readonly timeoutMs?: number
  readonly staleMs?: number
  readonly retryMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isExists = (error: unknown): boolean =>
  typeof error === "object" && error !== null && (error as { code?: string }).code === "EEXIST"

const clearIfStale = async (lockDir: string, staleMs: number): Promise<void> => {
  try {
    const info = await stat(lockDir)
    if (Date.now() - info.mtimeMs > staleMs) await rm(lockDir, { recursive: true, force: true })
  } catch (error) {
    // The holder released it between our mkdir and stat: nothing to clear.
    if ((error as { code?: string }).code !== "ENOENT") throw error
  }
}

export const withFileLock = async <T>(
  lockDir: string,
  work: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> => {
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  for (;;) {
    try {
      await mkdir(lockDir)
      break
    } catch (error) {
      if (!isExists(error)) throw error
      await clearIfStale(lockDir, options.staleMs ?? 10_000)
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${lockDir}`)
      await sleep(options.retryMs ?? 25)
    }
  }
  try {
    return await work()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}
