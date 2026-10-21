import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { DEFAULT_AGENCY, findRepoRoot, getAgency, storeDir } from "@/lib/store"

const consoleDir = resolve(__dirname, "..")
const repoRoot = resolve(consoleDir, "../..")

afterEach(() => {
  delete process.env.VISITPROOF_DEMO_STORE_PATH
})

describe("store path resolution", () => {
  it("finds the monorepo root from the console directory", () => {
    expect(findRepoRoot(consoleDir)).toBe(repoRoot)
  })

  it("defaults to the repo-root demo store and resolves relative paths from the root", () => {
    expect(storeDir()).toBe(join(repoRoot, ".demo-data"))
    process.env.VISITPROOF_DEMO_STORE_PATH = "tmp/store"
    expect(storeDir()).toBe(join(repoRoot, "tmp/store"))
  })
})

describe("getAgency", () => {
  it("falls back to the default only when no agency record exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "visitproof-agency-"))
    process.env.VISITPROOF_DEMO_STORE_PATH = dir
    try {
      expect(await getAgency()).toEqual(DEFAULT_AGENCY)
      await writeFile(join(dir, "agency.json"), "{ not json", "utf8")
      await expect(getAgency()).rejects.toThrow()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
