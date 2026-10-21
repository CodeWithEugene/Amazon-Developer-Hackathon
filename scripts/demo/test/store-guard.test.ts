import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { ROOT } from "../config"
import {
  acquireStoreLock,
  assertResettable,
  isKnownStoreEntry,
  resetStore,
  STORE_LOCK,
  STORE_MARKER,
} from "../store-guard"

const scratch = () => mkdtemp(join(tmpdir(), "vp-demo-guard-"))

describe("assertResettable", () => {
  it("accepts a missing, an empty, or a marked directory in the temp area", async () => {
    const dir = await scratch()
    await expect(
      assertResettable(join(dir, "new-store"), ROOT)
    ).resolves.toBeUndefined()
    await expect(assertResettable(dir, ROOT)).resolves.toBeUndefined()
    await writeFile(join(dir, "notes.txt"), "mine")
    await writeFile(join(dir, STORE_MARKER), "")
    await expect(assertResettable(dir, ROOT)).resolves.toBeUndefined()
  })

  it("accepts an older unmarked demo store made only of store files", async () => {
    const dir = await scratch()
    for (const name of [
      "agency.json",
      "visits.json",
      "ledger.json",
      "visits.json.lock",
    ]) {
      await writeFile(join(dir, name), "[]")
    }
    await expect(assertResettable(dir, ROOT)).resolves.toBeUndefined()
  })

  it("refuses a directory holding other files", async () => {
    const dir = await scratch()
    await writeFile(join(dir, "thesis.docx"), "precious")
    await expect(assertResettable(dir, ROOT)).rejects.toThrow(
      /not a VisitProof demo store/
    )
  })

  it("refuses paths outside the repository and the temp directory", async () => {
    await expect(assertResettable(homedir(), ROOT)).rejects.toThrow(
      /inside the repository/
    )
    await expect(assertResettable(ROOT, ROOT)).rejects.toThrow(
      /inside the repository/
    )
    await expect(assertResettable("/", ROOT)).rejects.toThrow(
      /inside the repository/
    )
  })

  it("recognizes store files and temp writes", () => {
    expect(isKnownStoreEntry("events.json")).toBe(true)
    expect(
      isKnownStoreEntry(
        "visits.json.4242.0b8d1c2e-1111-4a5b-9c9d-123456789abc.tmp"
      )
    ).toBe(true)
    expect(isKnownStoreEntry("README.md")).toBe(false)
  })
})

describe("store lock", () => {
  it("refuses a second live owner and takes over a dead one's lock", async () => {
    const dir = await scratch()
    const first = await acquireStoreLock(dir)
    await expect(
      acquireStoreLock(dir, process.pid + 1_000_000)
    ).rejects.toThrow(/another demo \(pid/)
    await first.release()
    await writeFile(join(dir, STORE_LOCK), "999999999\n")
    const second = await acquireStoreLock(dir)
    expect((await readFile(join(dir, STORE_LOCK), "utf8")).trim()).toBe(
      String(process.pid)
    )
    await second.release()
    expect(await readdir(dir)).not.toContain(STORE_LOCK)
  })
})

describe("resetStore", () => {
  it("keeps the lock and Ring tokens, removes the rest, and writes the marker", async () => {
    const dir = await scratch()
    const lock = await acquireStoreLock(dir)
    await writeFile(join(dir, "visits.json"), "[]")
    await writeFile(join(dir, "ring-tokens.json"), "{}")
    expect(await resetStore(dir)).toEqual(["ring-tokens.json"])
    expect((await readdir(dir)).sort()).toEqual(
      [STORE_LOCK, STORE_MARKER, "ring-tokens.json"].sort()
    )
    await lock.release()
  })
})
