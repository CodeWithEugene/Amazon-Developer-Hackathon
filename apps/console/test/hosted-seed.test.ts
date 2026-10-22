import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { verifyLedgerRecords } from "@/lib/store/ledger"
import { hostedStoreDir } from "@/lib/store/hosted-seed"
import { daysSinceSeed, rebaseText, shiftInstant } from "@/lib/store/rebase"
import { formatLocalTime } from "@/lib/time"

const ZONE = "America/New_York"
const cleanup: string[] = []

afterEach(async () => {
  delete process.env.VISITPROOF_SEED_DIR
  delete process.env.VISITPROOF_HOSTED_STORE_ROOT
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("rebase", () => {
  it("keeps the agency wall clock time across a DST change", () => {
    const before = Date.parse("2026-10-22T13:00:00.000Z") // 9:00 AM EDT
    const after = shiftInstant(before, 14, ZONE)
    expect(new Date(after).toISOString()).toBe("2026-11-05T14:00:00.000Z") // 9:00 AM EST
    expect(formatLocalTime(new Date(after).toISOString(), ZONE)).toBe(formatLocalTime(new Date(before).toISOString(), ZONE))
  })

  it("moves date keys, instants, and event epochs together", () => {
    const text = '{"key":"VISIT#2026-10-22T13:00:00.000Z#v","date":"2026-10-22","timestampMs":1792674000000,"k":"EVENT#1792674000000#x"}'
    const moved = rebaseText(text, 1, ZONE)
    expect(moved).toContain("VISIT#2026-10-23T13:00:00.000Z#v")
    expect(moved).toContain('"date":"2026-10-23"')
    expect(moved).toContain(`"timestampMs":${1792674000000 + 86_400_000}`)
    expect(moved).toContain(`EVENT#${1792674000000 + 86_400_000}#x`)
    expect(rebaseText(text, 0, ZONE)).toBe(text)
  })

  it("counts days from the seed day in the agency zone", () => {
    expect(daysSinceSeed("2026-10-22", new Date("2026-10-25T03:00:00Z"), ZONE)).toBe(2)
  })
})

describe("hosted store", () => {
  it("copies the shipped seed onto today and re-signs a verifiable ledger", async () => {
    const root = await mkdtemp(join(tmpdir(), "visitproof-hosted-"))
    cleanup.push(root)
    process.env.VISITPROOF_SEED_DIR = resolve(__dirname, "../demo-seed")
    process.env.VISITPROOF_HOSTED_STORE_ROOT = root
    const dir = hostedStoreDir(new Date("2026-11-10T15:00:00Z"))
    expect(hostedStoreDir(new Date("2026-11-10T16:00:00Z"))).toBe(dir)
    const visits = await readFile(join(dir, "visits.json"), "utf8")
    expect(visits).toContain('"date": "2026-11-10"')
    type Ledger = Parameters<typeof verifyLedgerRecords>[0][number]
    const ledger = JSON.parse(await readFile(join(dir, "ledger.json"), "utf8")) as { item: Ledger }[]
    const byClient = new Map<string, Ledger[]>()
    for (const { item } of ledger) byClient.set(item.clientId, [...(byClient.get(item.clientId) ?? []), item])
    expect(byClient.size).toBeGreaterThan(0)
    for (const records of byClient.values()) expect(verifyLedgerRecords(records)).toBe(true)
  })
})
