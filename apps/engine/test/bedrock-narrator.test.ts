import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime"
import { mockClient } from "aws-sdk-client-mock"
import { afterEach, describe, expect, it } from "vitest"

import { createBedrockNarrator, DEFAULT_BEDROCK_MODEL_ID } from "../src"
import { silentLogger, testVisit } from "./helpers"

const bedrock = mockClient(BedrockRuntimeClient)
afterEach(() => bedrock.reset())

const visit = testVisit({
  status: "completed",
  arrival: { at: "2026-10-01T12:04:00.000Z", source: "rule" },
  departure: { at: "2026-10-01T14:01:00.000Z", source: "rule" },
})
const now = new Date("2026-10-01T15:00:00.000Z")
const reply = (text: string, stopReason = "end_turn") => ({
  output: { message: { role: "assistant" as const, content: [{ text }] } },
  stopReason: stopReason as "end_turn",
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  metrics: { latencyMs: 1 },
  $metadata: {},
})

describe("Bedrock narrator (Converse)", () => {
  it("returns a validated model narrative with provenance bedrock", async () => {
    // The validator checks the arrival time exactly as the template wrote it.
    const draftTime = "12:04"
    bedrock
      .on(ConverseCommand)
      .resolves(
        reply(`A caregiver arrived at ${draftTime} and stayed for the visit.`)
      )
    const narrator = createBedrockNarrator({
      client: new BedrockRuntimeClient({ region: "us-east-1" }),
      guardrail: { id: "gr-1", version: "3" },
    })
    const narrative = await narrator.write({ visit, now })
    expect(narrative.provenance).toBe("bedrock")
    const input = bedrock.commandCalls(ConverseCommand)[0]?.args[0].input
    expect(input?.modelId).toBe(DEFAULT_BEDROCK_MODEL_ID)
    expect(input?.guardrailConfig).toEqual({
      guardrailIdentifier: "gr-1",
      guardrailVersion: "3",
    })
    // Facts only: the caregiver id and client id never reach the model.
    expect(JSON.stringify(input?.messages)).not.toContain("cg1")
    expect(JSON.stringify(input?.messages)).not.toContain('c1"')
  })

  it("falls back to the template when the output breaks the narrative rules", async () => {
    bedrock
      .on(ConverseCommand)
      .resolves(reply("Maria Lopez came by and everything was lovely."))
    const logger = silentLogger()
    const narrator = createBedrockNarrator({
      client: new BedrockRuntimeClient({}),
      logger,
    })
    const narrative = await narrator.write({ visit, now })
    expect(narrative.provenance).toBe("template")
    expect(logger.warnings[0]).toContain("rejected")
  })

  it("falls back to the template when the guardrail intervenes", async () => {
    bedrock
      .on(ConverseCommand)
      .resolves(reply("12:04 blocked", "guardrail_intervened"))
    const narrator = createBedrockNarrator({
      client: new BedrockRuntimeClient({}),
      logger: silentLogger(),
    })
    expect((await narrator.write({ visit, now })).provenance).toBe("template")
  })

  it("falls back to the template when Bedrock throws", async () => {
    bedrock
      .on(ConverseCommand)
      .rejects(
        Object.assign(new Error("slow down"), { name: "ThrottlingException" })
      )
    const logger = silentLogger()
    const narrator = createBedrockNarrator({
      client: new BedrockRuntimeClient({}),
      logger,
    })
    const narrative = await narrator.write({ visit, now })
    expect(narrative.provenance).toBe("template")
    expect(logger.warnings[0]).toContain("Converse failed")
  })
})
