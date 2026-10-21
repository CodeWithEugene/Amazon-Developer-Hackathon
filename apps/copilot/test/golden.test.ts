import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { z } from "zod"
import golden from "@visitproof/mcp/golden.json"

import { askConfigSchema, askVisitProof, demoTokenFor } from "../src/index"
import { DEMO_NOW, startMcp, type RunningMcp } from "./mcp-server"

const goldenSchema = z.object({
  utterances: z.array(
    z.object({
      utterance: z.string(),
      persona: z.enum(["family", "agency"]),
      calls: z.array(z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) })),
      spokenIncludes: z.array(z.string()),
      pending: z.boolean().optional(),
    }),
  ),
})

const { utterances } = goldenSchema.parse(golden)
let mcp: RunningMcp

beforeAll(async () => {
  mcp = await startMcp()
})

afterAll(async () => {
  await mcp.close()
})

describe("golden utterances against the fixture brain over MCP", () => {
  it.each(utterances.map((entry) => [entry.utterance, entry] as const))("%s", async (_label, entry) => {
    const token = demoTokenFor(entry.persona, undefined)?.token
    const turn = await askVisitProof(
      { utterance: entry.utterance, persona: entry.persona, ...(token ? { token } : {}) },
      { config: askConfigSchema.parse({ mcpUrl: mcp.url }), now: () => DEMO_NOW },
    )
    expect(turn.brain).toBe("fixture")
    expect(turn.toolCalls.map((call) => call.name)).toEqual(entry.calls.map((call) => call.name))
    entry.calls.forEach((expected, index) => {
      expect(turn.toolCalls[index]?.arguments).toMatchObject(expected.arguments)
      expect(turn.toolCalls[index]?.isError).toBe(false)
    })
    for (const phrase of entry.spokenIncludes) expect(turn.spoken).toContain(phrase)
    expect(Boolean(turn.pendingConfirmation)).toBe(Boolean(entry.pending))
  })
})
