import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { askConfigFromEnv, askConfigSchema, askVisitProof, demoTokenFor, type AskTurn } from "../src/index"
import { createStrandsBrain } from "../src/ask/strands-brain"
import { DEMO_NOW, startMcp, type RunningMcp } from "./mcp-server"
import { ScriptedModel } from "./scripted-model"

let mcp: RunningMcp

beforeEach(async () => {
  mcp = await startMcp()
})

afterEach(async () => {
  await mcp.close()
})

const FAMILY = demoTokenFor("family", undefined)!.token
const AGENCY = demoTokenFor("agency", undefined)!.token
const fixtureConfig = () => askConfigSchema.parse({ mcpUrl: mcp.url })
const ask = (utterance: string, persona: "family" | "agency", extra: Partial<Parameters<typeof askVisitProof>[0]> = {}) =>
  askVisitProof({ utterance, persona, token: persona === "family" ? FAMILY : AGENCY, ...extra }, { config: fixtureConfig(), now: () => DEMO_NOW })

describe("Ask VisitProof with the fixture brain", () => {
  it("confirms a pending note on yes and writes it through MCP", async () => {
    const first = await ask("Tell the agency I'll be there Thursday instead", "family")
    expect(first.pendingConfirmation?.name).toBe("add_visit_note")
    const second = await ask("Yes", "family", { pending: first.pendingConfirmation })
    expect(second.toolCalls[0]?.arguments).toMatchObject({ confirmed: true, visitId: "v_okoro_27" })
    expect(second.toolCalls[0]?.structuredContent).toMatchObject({ status: "done", confirmationMethod: "confirmed_argument" })
    expect(second.pendingConfirmation).toBeUndefined()
  })

  it("declines a pending write on no", async () => {
    const first = await ask("Acknowledge the no-show for Rosa", "agency")
    const second = await ask("No, cancel that", "agency", { pending: first.pendingConfirmation })
    expect(second.toolCalls[0]?.structuredContent).toMatchObject({ status: "declined" })
  })

  it("keeps the family on family tools and records a trace", async () => {
    const turn = await ask("Any problems today?", "family")
    expect(turn.toolCalls.map((call) => call.name)).toEqual(["get_visit_status"])
    expect(turn.trace.map((step) => step.step)).toEqual(["initialize", "tools/list", "tools/call get_visit_status"])
  })

  it("fails loudly when the MCP server is unreachable", async () => {
    await mcp.close()
    await expect(ask("Did the caregiver come today?", "family")).rejects.toThrow()
    mcp = await startMcp()
  })
})

describe("Ask VisitProof with the Strands brain (scripted model, no AWS)", () => {
  const bedrockConfig = () => askConfigSchema.parse({ mcpUrl: mcp.url, modelProvider: "bedrock", modelId: "global.amazon.nova-2-lite-v1:0" })

  it("runs a Strands agent whose tools come from the MCP server", async () => {
    const model = new ScriptedModel([{ name: "get_visit_status", input: {} }])
    const turn: AskTurn = await askVisitProof(
      { utterance: "Did the caregiver come today?", persona: "family", token: FAMILY },
      { config: bedrockConfig(), now: () => DEMO_NOW, bedrockBrain: async (config, token) => createStrandsBrain({ mcpUrl: config.mcpUrl, modelId: config.modelId, model, ...(token ? { token } : {}) }) },
    )
    expect(turn.brain).toBe("bedrock")
    expect(turn.toolCalls.map((call) => call.name)).toEqual(["get_visit_status"])
    expect(turn.toolCalls[0]?.structuredContent).toMatchObject({ answer: "yes", clientId: "cli_okoro" })
    expect(turn.spoken).toContain("someone arrived at the door at 8:04 AM ET")
    expect(model.seenSystemPrompts[0]).toContain("never say who")
  })

  it("carries a confirmation request from the Strands agent", async () => {
    const model = new ScriptedModel([{ name: "add_visit_note", input: { visitId: "v_okoro_27", text: "Running late" } }])
    const turn = await askVisitProof(
      { utterance: "Tell the agency I am running late", persona: "family", token: FAMILY },
      { config: bedrockConfig(), now: () => DEMO_NOW, bedrockBrain: async (config, token) => createStrandsBrain({ mcpUrl: config.mcpUrl, modelId: config.modelId, model, ...(token ? { token } : {}) }) },
    )
    expect(turn.pendingConfirmation).toEqual({ name: "add_visit_note", arguments: { visitId: "v_okoro_27", text: "Running late" } })
  })

  it("falls back to the fixture brain and says so when Bedrock fails", async () => {
    const turn = await askVisitProof(
      { utterance: "Did the caregiver come today?", persona: "family", token: FAMILY },
      { config: bedrockConfig(), now: () => DEMO_NOW, bedrockBrain: async () => ({ name: "bedrock", answer: () => Promise.reject(new Error("no credentials")) }) },
    )
    expect(turn.brain).toBe("fixture")
    expect(turn.reasoning).toContain("Bedrock unavailable: no credentials")
    expect(turn.trace[0]).toMatchObject({ step: "bedrock failed", detail: "no credentials" })
  })
})

describe("configuration", () => {
  it("reads MODEL_PROVIDER, MCP_URL, and BEDROCK_MODEL_ID with defaults", () => {
    expect(askConfigFromEnv({})).toMatchObject({ modelProvider: "fixture", mcpUrl: "http://localhost:8000/mcp", modelId: "global.amazon.nova-2-lite-v1:0" })
    expect(askConfigFromEnv({ MODEL_PROVIDER: "bedrock", MCP_URL: "http://127.0.0.1:8123/mcp", BEDROCK_MODEL_ID: "m" })).toMatchObject({ modelProvider: "bedrock", mcpUrl: "http://127.0.0.1:8123/mcp", modelId: "m" })
  })

  it("picks demo tokens by persona scope", () => {
    expect(demoTokenFor("family", "a=agency,f=family:cli_x")).toEqual({ token: "f", scope: "family:cli_x" })
    expect(demoTokenFor("agency", "family-demo-token,agency-demo-token")?.token).toBe("agency-demo-token")
    expect(demoTokenFor("agency", "f=family:cli_x")).toBeUndefined()
  })
})
