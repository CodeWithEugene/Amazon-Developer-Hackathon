import "server-only"

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { LedgerRecord } from "@visitproof/domain"

export { isHostedDemo } from "./hosted"
import { signLedgerDigest } from "./ledger"
import { daysSinceSeed, rebaseText, resignLedger } from "./rebase"

/**
 * Hosted demo store (VISITPROOF_HOSTED_DEMO=1, the public Vercel site).
 * Serverless functions have a read-only filesystem except the temp
 * directory, so the console ships the store `pnpm demo` produced
 * (apps/console/demo-seed), copies it into the temp directory moved onto
 * the current week, and reads and writes it there. Writes last only as long
 * as the function instance; a cold start begins from the seed again.
 */

const MARKER = ".visitproof-hosted-store"

interface SeedMeta {
  seedDay: string
  timeZone: string
}

interface StoredRow {
  key: string
  item: LedgerRecord
}


function seedDir(): string {
  const candidates = [
    process.env.VISITPROOF_SEED_DIR,
    join(process.cwd(), "demo-seed"),
    join(process.cwd(), "apps/console/demo-seed"),
  ].filter((dir): dir is string => Boolean(dir))
  const found = candidates.find((dir) => existsSync(join(dir, "seed-meta.json")))
  if (!found) throw new Error(`Hosted demo seed not found (looked in ${candidates.join(", ")}).`)
  return found
}

function writeRebasedStore(source: string, target: string, days: number, meta: SeedMeta): void {
  const staging = `${target}.${process.pid}.${Date.now()}`
  mkdirSync(staging, { recursive: true })
  for (const name of readdirSync(source)) {
    if (!name.endsWith(".json") || name === "seed-meta.json") continue
    let text = rebaseText(readFileSync(join(source, name), "utf8"), days, meta.timeZone)
    if (name === "ledger.json") {
      const rows = JSON.parse(text) as StoredRow[]
      const byKey = new Map(rows.map((row) => [`${row.item.clientId}#${row.item.seq}`, row.key]))
      const signed = resignLedger(rows.map((row) => row.item), signLedgerDigest)
      text = JSON.stringify(signed.map((item) => ({ key: byKey.get(`${item.clientId}#${item.seq}`), item })), null, 2)
    }
    writeFileSync(join(staging, name), text)
  }
  writeFileSync(join(staging, MARKER), `${meta.seedDay} +${days}d\n`)
  try {
    renameSync(staging, target)
  } catch (error) {
    // Another request on this instance finished first; its copy is identical.
    if (!existsSync(join(target, MARKER))) throw error
  }
}

/** The temp-directory store for today, created from the seed on first use. */
export function hostedStoreDir(now: Date = new Date()): string {
  const source = seedDir()
  const meta = JSON.parse(readFileSync(join(source, "seed-meta.json"), "utf8")) as SeedMeta
  const days = daysSinceSeed(meta.seedDay, now, meta.timeZone)
  const target = join(process.env.VISITPROOF_HOSTED_STORE_ROOT ?? tmpdir(), `visitproof-hosted-store-${days}`)
  if (!existsSync(join(target, MARKER))) writeRebasedStore(source, target, days, meta)
  return target
}
