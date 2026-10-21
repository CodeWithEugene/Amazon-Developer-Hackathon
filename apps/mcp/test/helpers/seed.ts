import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLocalRepository, type VisitProofRepository } from "@visitproof/db"

import { createDbVisitRepository } from "../../src/db-repo"
import { FIXTURE_AGENCY_ID, fixtureSeed, type FixtureSeed } from "../../src/fixtures"
import type { VisitRepository } from "../../src/repo"

export interface SeededStore {
  readonly dir: string
  readonly seed: FixtureSeed
  /** A fresh repository over the directory, as each server request gets. */
  readonly store: () => VisitProofRepository
  readonly repo: VisitRepository
  cleanup(): Promise<void>
}

/**
 * Seeds a temp-directory local repository with the demo-shaped fixture world
 * (the same writes scripts/demo.ts performs) plus `agency.json`.
 */
export async function seedLocalStore(mutate?: (seed: FixtureSeed) => FixtureSeed): Promise<SeededStore> {
  const dir = await mkdtemp(join(tmpdir(), "visitproof-mcp-"))
  const seed = mutate ? mutate(fixtureSeed()) : fixtureSeed()
  const repo = createLocalRepository(dir)
  for (const client of seed.clients) await repo.clients.put(client)
  for (const caregiver of seed.caregivers) await repo.caregivers.put(caregiver)
  for (const visit of seed.visits) await repo.visits.put(visit)
  for (const exception of seed.exceptions) await repo.exceptions.put(exception)
  for (const event of seed.events) await repo.events.put(event)
  for (const note of seed.notes) await repo.evidence.putNote(note)
  for (const record of seed.ledger) await repo.evidence.appendLedger(record)
  await writeFile(join(dir, "agency.json"), `${JSON.stringify(seed.agency, null, 2)}\n`)
  const store = () => createLocalRepository(dir)
  return {
    dir,
    seed,
    store,
    repo: createDbVisitRepository(store, {
      agencyId: FIXTURE_AGENCY_ID,
      settings: { timeZone: seed.agency.timezone, tolerances: seed.agency.tolerances },
    }),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}
