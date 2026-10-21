import { randomUUID } from "node:crypto"
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises"
import { dirname } from "node:path"

import { DbError } from "../errors"

/**
 * Cross-process exclusive lock over a lockfile (contract C8). The console,
 * webhooks server, MCP server, and demo script all write the same local store
 * directory, so every read-modify-write runs inside `withFileLock`.
 *
 * Acquisition is `open(path, "wx")` (atomic create-or-fail), retried with
 * jittered exponential backoff. A lock whose owner process is gone, or that is
 * older than `staleMs`, is recovered: it is renamed aside (only one contender
 * can win that rename), the renamed copy is checked to be the stale owner we
 * observed, and a lock that turns out to be live is linked back.
 */

export class LockTimeoutError extends DbError {}

export interface FileLockOptions {
  /** Give up after this long. */
  readonly timeoutMs?: number
  /** A lock older than this is treated as abandoned. */
  readonly staleMs?: number
  readonly initialDelayMs?: number
  readonly maxDelayMs?: number
}

const DEFAULTS = Object.freeze({
  timeoutMs: 15_000,
  staleMs: 10_000,
  initialDelayMs: 2,
  maxDelayMs: 50,
})

interface LockOwner {
  readonly token: string
  readonly pid: number
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return errorCode(error) === "EPERM"
  }
}

const readOwner = async (path: string): Promise<LockOwner | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"))
    if (typeof parsed !== "object" || parsed === null) return null
    const { token, pid } = parsed as { token?: unknown; pid?: unknown }
    return typeof token === "string" && typeof pid === "number"
      ? { token, pid }
      : null
  } catch (error) {
    // Absent (released meanwhile) or half-written by a live owner: not ours to judge.
    if (errorCode(error) === "ENOENT" || error instanceof SyntaxError)
      return null
    throw error
  }
}

const tryCreate = async (path: string, owner: LockOwner): Promise<boolean> => {
  try {
    const handle = await open(path, "wx")
    try {
      await handle.writeFile(JSON.stringify(owner), "utf8")
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false
    throw error
  }
}

const isStale = async (
  path: string,
  staleMs: number
): Promise<LockOwner | null> => {
  let ageMs: number
  try {
    ageMs = Date.now() - (await stat(path)).mtimeMs
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null
    throw error
  }
  const owner = await readOwner(path)
  if (owner === null) {
    // Unreadable lock content older than staleMs is abandoned; younger may be mid-write.
    return ageMs > staleMs ? { token: "", pid: -1 } : null
  }
  if (ageMs > staleMs || !isProcessAlive(owner.pid)) return owner
  return null
}

/** Moves a stale lock aside; restores it if a live owner replaced it meanwhile. */
const recoverStale = async (
  path: string,
  observed: LockOwner
): Promise<void> => {
  const aside = `${path}.stale-${randomUUID()}`
  try {
    await rename(path, aside)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return // someone else recovered it
    throw error
  }
  const moved = await readOwner(aside)
  const stillStale = observed.token === "" || moved?.token === observed.token
  if (!stillStale) {
    try {
      await link(aside, path)
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
    }
  }
  await unlink(aside)
}

const release = async (path: string, owner: LockOwner): Promise<void> => {
  const current = await readOwner(path)
  if (current?.token !== owner.token) return // recovered as stale by another process
  try {
    await unlink(path)
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error
  }
}

const acquire = async (
  path: string,
  options: Required<FileLockOptions>
): Promise<LockOwner> => {
  const owner: LockOwner = { token: randomUUID(), pid: process.pid }
  const deadline = Date.now() + options.timeoutMs
  let delay = options.initialDelayMs
  await mkdir(dirname(path), { recursive: true })
  for (;;) {
    if (await tryCreate(path, owner)) return owner
    const stale = await isStale(path, options.staleMs)
    if (stale !== null) {
      await recoverStale(path, stale)
      continue
    }
    if (Date.now() >= deadline) {
      throw new LockTimeoutError(
        `timed out after ${options.timeoutMs} ms waiting for ${path}`
      )
    }
    await sleep(delay + Math.random() * delay)
    delay = Math.min(delay * 2, options.maxDelayMs)
  }
}

/** In-process queue per lock path so same-process callers do not spin on the file. */
const localQueues = new Map<string, Promise<unknown>>()

/** Runs `fn` while holding the exclusive lock at `lockPath`. */
export const withFileLock = async <T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {}
): Promise<T> => {
  const resolved = { ...DEFAULTS, ...options }
  const previous = localQueues.get(lockPath) ?? Promise.resolve()
  const run = previous
    .catch(() => undefined) // a predecessor's failure is reported to its own caller
    .then(async () => {
      const owner = await acquire(lockPath, resolved)
      try {
        return await fn()
      } finally {
        await release(lockPath, owner)
      }
    })
  localQueues.set(lockPath, run)
  try {
    return await run
  } finally {
    if (localQueues.get(lockPath) === run) localQueues.delete(lockPath)
  }
}
