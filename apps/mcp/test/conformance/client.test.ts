import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js"

import { createHttpApp } from "../../src/index"
import { createFixtureRepository, DEMO_NOW } from "../../src/repo"
import { firstMessage, initialize, listen, postRaw, rpc, type Running } from "./http"

let stateful: Running
let stateless: Running
const TOKENS = ["agency-demo-token=agency"]

beforeAll(async () => {
  const base = { now: () => DEMO_NOW, tokens: TOKENS, mode: "demo" as const, env: {} }
  stateful = await listen(createHttpApp({ ...base, repo: createFixtureRepository() }))
  stateless = await listen(createHttpApp({ ...base, repo: createFixtureRepository(), stateless: true }))
})

afterAll(async () => {
  await stateful.close()
  await stateless.close()
})

const connect = async (url: string, elicitation: "accept" | "decline" | "none") => {
  const client = new Client(
    { name: "conformance-sdk", version: "0.0.0" },
    { capabilities: elicitation === "none" ? {} : { elicitation: { form: {} } } },
  )
  if (elicitation !== "none") {
    client.setRequestHandler(ElicitRequestSchema, async () =>
      elicitation === "accept" ? { action: "accept", content: { confirm: true } } : { action: "decline" },
    )
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { authorization: "Bearer agency-demo-token" } },
  })
  await client.connect(transport)
  return client
}

describe("MCP conformance: SDK client over Streamable HTTP", () => {
  it("confirms a write through elicitation when the client supports it", async () => {
    const client = await connect(stateful.url, "accept")
    const result = await client.callTool({ name: "acknowledge_exception", arguments: { exceptionId: "v_alvarez_26#no_show", reason: "caregiver_sick" } })
    expect(result.structuredContent).toMatchObject({ status: "done", confirmationMethod: "elicitation" })
    await client.close()
  })

  it("writes nothing when the user declines the elicitation", async () => {
    const client = await connect(stateful.url, "decline")
    const result = await client.callTool({ name: "acknowledge_exception", arguments: { exceptionId: "v_nakamura_27#late_arrival", reason: "road_work" } })
    expect(result.structuredContent).toMatchObject({ status: "declined" })
    await client.close()
  })

  it("validates structured output against every tool's output schema", async () => {
    const client = await connect(stateful.url, "none")
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(7)
    const result = await client.callTool({ name: "list_visits", arguments: {} })
    expect((result.structuredContent as { count: number }).count).toBe(6)
    await client.close()
  })
})

describe("MCP conformance: stateless mode (serverless)", () => {
  it("answers each POST with JSON and no session", async () => {
    const init = await postRaw(stateless.url, initialize(1), { token: "agency-demo-token" })
    expect(init.status).toBe(200)
    expect(init.contentType).toContain("application/json")
    expect(init.sessionId).toBeUndefined()
    const list = await postRaw(stateless.url, rpc("tools/list", {}, 2), { token: "agency-demo-token" })
    expect((firstMessage(list).result as { tools: unknown[] }).tools).toHaveLength(7)
  })

  it("rejects GET with 405", async () => {
    const response = await fetch(`${stateless.url}/mcp`, { headers: { authorization: "Bearer agency-demo-token", accept: "text/event-stream" } })
    expect(response.status).toBe(405)
  })
})
