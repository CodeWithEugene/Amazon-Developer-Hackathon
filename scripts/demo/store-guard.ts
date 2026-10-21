/**
 * Store safety for `pnpm demo`. The demo resets its store on every run, so
 * it must never delete a directory it did not create, or one another demo
 * is using:
 *
 * - the directory must be inside the repository or the system temp
 *   directory, and must be missing, empty, marked with the demo marker
 *   file, or hold only files a demo store contains;
 * - an exclusive lock file (with the owner's pid) is taken before anything
 *   is deleted; a live owner makes the second demo exit, a dead owner's
 *   lock is taken over;
 * - Ring tokens linked through the console (ring-tokens.json) survive the
 *   reset.
 */
import { realpathSync } from "node:fs"
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"

import { DemoError } from "./log"

export const STORE_MARKER = ".visitproof-demo-store"
export const STORE_LOCK = ".visitproof-demo.lock"
/** Files kept across a reset (Ring OAuth tokens the family linked). */
export const PRESERVED_FILES: ReadonlySet<string> = new Set([
  "ring-tokens.json",
])

const TABLES = [
  "agencies",
  "visits",
  "events",
  "exceptions",
  "caregivers",
  "clients",
  "ring-accounts",
  "evv-records",
  "notes",
  "snapshots",
  "ledger",
  "webhook-receipts",
]
const KNOWN_FILES = new Set([
  "agency.json",
  "evv-import.csv",
  "webhook-inbox",
  "ring-tokens.json",
  STORE_MARKER,
  STORE_LOCK,
  ...TABLES.map((table) => `${table}.json`),
])

/** A file an older demo (without the marker) or the local repository writes. */
export const isKnownStoreEntry = (name: string): boolean =>
  KNOWN_FILES.has(name) ||
  /\.(lock|tmp)$/.test(name) ||
  /\.json\.\d+\.[0-9a-f-]+\.tmp$/.test(name)

const isMissing = (error: unknown): boolean =>
  (error as NodeJS.ErrnoException).code === "ENOENT"

const realOrResolved = (path: string): string => {
  try {
    return realpathSync(path)
  } catch (error) {
    if (isMissing(error)) return resolve(path)
    throw error
  }
}

/** Real path of `path`, or of its nearest existing ancestor joined with the rest. */
function canonical(path: string): string {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent === absolute) return absolute
  try {
    return realpathSync(absolute)
  } catch (error) {
    if (!isMissing(error)) throw error
    return join(canonical(parent), basename(absolute))
  }
}

const isInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep)
}

/** Allowed parents: the repository and the temp directories. */
export function allowedRoots(repoRoot: string): string[] {
  return [
    ...new Set(
      [repoRoot, tmpdir(), "/tmp", "/private/tmp"].map(realOrResolved)
    ),
  ]
}

const readEntries = async (dir: string): Promise<string[] | null> => {
  try {
    return await readdir(dir)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/** Throws unless `storeDir` is a place the demo may reset. */
export async function assertResettable(
  storeDir: string,
  repoRoot: string
): Promise<void> {
  const target = canonical(storeDir)
  if (!allowedRoots(repoRoot).some((root) => isInside(target, root))) {
    throw new DemoError(
      `refusing to use ${storeDir}: the demo store must be inside the repository or the temp directory`
    )
  }
  const entries = await readEntries(target)
  if (
    entries === null ||
    entries.length === 0 ||
    entries.includes(STORE_MARKER)
  )
    return
  const unknown = entries.filter((name) => !isKnownStoreEntry(name))
  if (unknown.length === 0) return
  throw new DemoError(
    `refusing to reset ${storeDir}: it is not a VisitProof demo store (found ${unknown.slice(0, 3).join(", ")}). ` +
      "Point VISITPROOF_DEMO_STORE_PATH at a new or empty directory."
  )
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

async function lockOwner(lockPath: string): Promise<number | null> {
  try {
    const pid = Number.parseInt((await readFile(lockPath, "utf8")).trim(), 10)
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}

export interface StoreLock {
  readonly path: string
  release(): Promise<void>
}

/** Takes the store lock for this process, or throws naming the live owner. */
export async function acquireStoreLock(
  storeDir: string,
  pid: number = process.pid
): Promise<StoreLock> {
  await mkdir(storeDir, { recursive: true })
  const path = join(storeDir, STORE_LOCK)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx")
      await handle.writeFile(`${pid}\n`)
      await handle.close()
      return { path, release: () => releaseLock(path, pid) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
    const owner = await lockOwner(path)
    if (owner !== null && owner !== pid && isAlive(owner)) {
      throw new DemoError(
        `another demo (pid ${owner}) is using ${storeDir}. Stop it first, or set VISITPROOF_DEMO_STORE_PATH to another directory.`
      )
    }
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
    })
  }
  throw new DemoError(`could not take the store lock at ${path}`)
}

async function releaseLock(path: string, pid: number): Promise<void> {
  if ((await lockOwner(path)) !== pid) return
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error
  })
}

/**
 * Empties the store (keeping the lock and preserved files) and writes the
 * marker. Call only while holding the lock, after `assertResettable`.
 */
export async function resetStore(storeDir: string): Promise<string[]> {
  const entries = (await readEntries(storeDir)) ?? []
  const kept = entries.filter((name) => PRESERVED_FILES.has(name))
  for (const name of entries) {
    if (name === STORE_LOCK || PRESERVED_FILES.has(name)) continue
    await rm(join(storeDir, name), { recursive: true, force: true })
  }
  await writeFile(
    join(storeDir, STORE_MARKER),
    "Created by pnpm demo. Safe to delete.\n"
  )
  return kept
}
