import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createLocalRepository } from "@visitproof/db"
import type { Visit } from "@visitproof/domain"
import { fixtureSeed } from "@visitproof/mcp/fixtures"

import { createDbCopilotAccessor, createOpsCopilot } from "../src/index"
import { DEMO_NOW } from "./mcp-server"

let dir: string

/** Seeds a temp-directory local repository with the demo-shaped world (cli_*, two visits a day). */
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "visitproof-copilot-"))
  const seed = fixtureSeed()
  const repo = createLocalRepository(dir)
  for (const client of seed.clients) await repo.clients.put(client)
  for (const visit of seed.visits) await repo.visits.put(visit)
  for (const exception of seed.exceptions) await repo.exceptions.put(exception)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const copilot = () => createOpsCopilot({ accessor: createDbCopilotAccessor(createLocalRepository(dir), "a1"), now: () => DEMO_NOW })

describe("ops copilot over createDbCopilotAccessor and a seeded local store", () => {
  it("finds late arrivals whose terminal status is completed", async () => {
    const answer = await copilot().ask("who was late this week?")
    expect((answer.data as Visit[]).map((visit) => visit.id).sort()).toEqual(["v_nakamura_27", "v_okoro_24"])
    expect(answer.answer).toContain("Ken, Sunday 9:00 AM ET, 22 minutes late")
    expect(answer.answer).toContain("Grace, Saturday 8:00 AM ET, 20 minutes late")
    expect(answer.answer).not.toMatch(/v_|cli_|T\d\d:/)
  })

  it("lists today's no-shows with names and agency-local times", async () => {
    const answer = await copilot().ask("any no-shows today?")
    expect(answer.answer).toBe("1 no-show: Rosa, Sunday 7:00 AM ET, no one at the door.")
  })

  it("reports evidence gaps including missing clock-ins", async () => {
    const answer = await copilot().ask("which visits are missing evidence this week")
    expect((answer.data as Visit[]).map((visit) => visit.id).sort()).toEqual(["v_alvarez_26", "v_nakamura_24", "v_nakamura_26"])
  })

  it("explains an exception by id in plain language", async () => {
    const answer = await copilot().ask("explain exception v_nakamura_26#unobservable")
    expect(answer.answer).toContain("The unobservable exception for Ken is open")
    expect(answer.answer).toContain("It could not be fully observed: device offline.")
  })
})
