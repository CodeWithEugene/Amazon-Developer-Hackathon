import { spawn } from "node:child_process"
import { mkdtemp, readdir, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { createLocalRepository, LockTimeoutError, withFileLock } from "../src"
import { makeClient, makeVisit } from "./fixtures"

const here = dirname(fileURLToPath(import.meta.url))
const TSX = join(here, "..", "node_modules", ".bin", "tsx")
const HAMMER = join(here, "workers", "hammer.ts")

const freshDir = () => mkdtemp(join(tmpdir(), "visitproof-db-conc-"))

const runHammer = (dir: string, workerId: string, count: number) =>
  new Promise<{ workerId: string; won: string[] }>((resolve, reject) => {
    const child = spawn(TSX, [HAMMER, dir, workerId, String(count)], {
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()))
    child.stderr.on("data", (chunk: Buffer) => (err += chunk.toString()))
    child.on("error", reject)
    child.on("close", (code) => {
      if (code !== 0)
        reject(new Error(`worker ${workerId} exited ${code}: ${err}`))
      else
        resolve(JSON.parse(out.trim()) as { workerId: string; won: string[] })
    })
  })

describe("local repository across processes (contract C8)", () => {
  it("loses no writes when two processes hammer the same store", async () => {
    const dir = await freshDir()
    const count = 40

    const results = await Promise.all([
      runHammer(dir, "a", count),
      runHammer(dir, "b", count),
    ])

    const repo = createLocalRepository(dir)
    const visits = await repo.visits.byClient("client-1")
    expect(visits).toHaveLength(count * 2)
    expect(await repo.clients.byAgency("agency-1")).toHaveLength(count * 2)
    // Every contended receipt was claimed by exactly one process.
    const claimed = results.flatMap((r) => r.won).sort()
    expect(claimed).toEqual(
      Array.from({ length: count }, (_, i) => `req-${i}`).sort()
    )
    // No temp or lock files are left behind.
    const leftovers = (await readdir(dir)).filter((f) =>
      /\.(tmp|lock)$/.test(f)
    )
    expect(leftovers).toEqual([])
  }, 60_000)

  it("a long-lived repository sees and keeps another instance's writes", async () => {
    const dir = await freshDir()
    const longLived = createLocalRepository(dir)
    const other = createLocalRepository(dir)

    await longLived.visits.put(makeVisit({ id: "v-long" }))
    expect(await longLived.visits.byClient("client-1")).toHaveLength(1)
    await other.visits.put(makeVisit({ id: "v-other" }))
    // Before the fix the long-lived instance served its cache and then
    // overwrote the file, dropping v-other.
    expect(await longLived.visits.byClient("client-1")).toHaveLength(2)
    await longLived.visits.put(makeVisit({ id: "v-long-2" }))
    const ids = (await other.visits.byClient("client-1"))
      .map((v) => v.id)
      .sort()
    expect(ids).toEqual(["v-long", "v-long-2", "v-other"])
  })

  it("serialises concurrent read-modify-writes inside one process", async () => {
    const dir = await freshDir()
    const repo = createLocalRepository(dir)
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        repo.clients.put(makeClient({ id: `c-${i}` }))
      )
    )
    expect(await repo.clients.byAgency("agency-1")).toHaveLength(25)
  })
})

describe("withFileLock stale-lock recovery", () => {
  it("recovers a lock left by a process that no longer exists", async () => {
    const dir = await freshDir()
    const lock = join(dir, "t.lock")
    await writeFile(lock, JSON.stringify({ token: "dead", pid: 2_147_483_000 }))
    const started = Date.now()
    expect(await withFileLock(lock, async () => "ran")).toBe("ran")
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("recovers a lock older than the stale timeout even if the pid is alive", async () => {
    const dir = await freshDir()
    const lock = join(dir, "t.lock")
    await writeFile(lock, JSON.stringify({ token: "old", pid: process.pid }))
    const past = new Date(Date.now() - 60_000)
    await utimes(lock, past, past)
    expect(await withFileLock(lock, async () => 1, { staleMs: 1_000 })).toBe(1)
  })

  it("times out on a fresh lock held by a live process", async () => {
    const dir = await freshDir()
    const lock = join(dir, "t.lock")
    await writeFile(lock, JSON.stringify({ token: "live", pid: process.pid }))
    await expect(
      withFileLock(lock, async () => 1, { timeoutMs: 100, staleMs: 60_000 })
    ).rejects.toBeInstanceOf(LockTimeoutError)
  })

  it("releases the lock when the critical section throws", async () => {
    const dir = await freshDir()
    const lock = join(dir, "t.lock")
    await expect(
      withFileLock(lock, async () => {
        throw new Error("boom")
      })
    ).rejects.toThrow("boom")
    expect(
      await withFileLock(lock, async () => "again", { timeoutMs: 200 })
    ).toBe("again")
  })
})
