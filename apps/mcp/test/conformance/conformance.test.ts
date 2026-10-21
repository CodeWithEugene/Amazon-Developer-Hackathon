import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createHttpApp } from "../../src/index"
import { createFixtureRepository, DEMO_NOW } from "../../src/repo"
import { firstMessage, initialize, listen, openSession, postRaw, rpc, type Running } from "./http"

let server: Running
let sessionId: string

beforeAll(async () => {
  server = await listen(createHttpApp({ repo: createFixtureRepository(), now: () => DEMO_NOW, allowAnonymous: true, env: {} }))
})

afterAll(async () => {
  await server.close()
})

const TOOL_NAMES = [
  "get_visit_status",
  "list_visits",
  "list_exceptions",
  "explain_visit",
  "get_client_summary",
  "acknowledge_exception",
  "add_visit_note",
]

describe("MCP conformance: Streamable HTTP transport (2025-03-26 and 2025-11-25)", () => {
  it("initializes with 2025-11-25 and returns a session id and instructions", async () => {
    const result = await postRaw(server.url, initialize(1))
    expect(result.status).toBe(200)
    expect(result.sessionId).toBeTruthy()
    sessionId = result.sessionId as string
    const message = firstMessage(result)
    expect(message.result).toMatchObject({ protocolVersion: "2025-11-25", serverInfo: { name: "visitproof" } })
    const instructions = (message.result as { instructions?: string }).instructions ?? ""
    expect(instructions).toContain("spoken")
    expect(instructions).toContain("never say who the door saw")
  })

  it("negotiates the 2025-03-26 protocol version the Alexa+ client sends", async () => {
    const result = await postRaw(server.url, initialize(2, "2025-03-26"))
    expect((firstMessage(result).result as { protocolVersion: string }).protocolVersion).toBe("2025-03-26")
  })

  it("accepts an initialized notification with 202", async () => {
    const result = await postRaw(server.url, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), { sessionId })
    expect(result.status).toBe(202)
  })

  it("rejects an unknown method with -32601", async () => {
    const result = await postRaw(server.url, rpc("no/such/method", {}, 5), { sessionId })
    expect((firstMessage(result).error as { code: number }).code).toBe(-32601)
  })

  it("returns 400 for malformed JSON", async () => {
    expect((await postRaw(server.url, "{not json", { sessionId })).status).toBe(400)
  })

  it("returns 400 for a request without a session that is not initialize", async () => {
    expect((await postRaw(server.url, rpc("tools/list", {}, 7))).status).toBe(400)
  })

  it("returns 404 for an unknown session id", async () => {
    const result = await postRaw(server.url, rpc("tools/list", {}, 8), { sessionId: "99999999-9999-4999-8999-999999999999" })
    expect(result.status).toBe(404)
  })

  it("opens the GET /mcp SSE stream for a known session", async () => {
    const controller = new AbortController()
    const response = await fetch(`${server.url}/mcp`, {
      headers: { accept: "text/event-stream", "mcp-session-id": sessionId },
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    controller.abort()
  })

  it("ends a session with DELETE", async () => {
    const session = await openSession(server.url)
    const response = await fetch(`${server.url}/mcp`, { method: "DELETE", headers: { "mcp-session-id": session.sessionId } })
    expect(response.status).toBe(200)
    expect((await postRaw(server.url, rpc("tools/list", {}, 9), { sessionId: session.sessionId })).status).toBe(404)
  })
})

describe("MCP conformance: tools, resources, prompts", () => {
  it("lists the seven tools of build.md Section 8.1 with honest annotations", async () => {
    const session = await openSession(server.url)
    const message = await session.request("tools/list", {})
    const tools = (message.result as { tools: Array<{ name: string; annotations?: Record<string, boolean>; outputSchema?: unknown }> }).tools
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES)
    for (const tool of tools) expect(tool.outputSchema).toBeTruthy()
    const readOnly = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]))
    expect(readOnly).toMatchObject({ get_visit_status: true, list_exceptions: true, acknowledge_exception: false, add_visit_note: false })
  })

  it("returns structuredContent plus a text block for every read tool", async () => {
    const session = await openSession(server.url)
    for (const [name, args] of [
      ["get_visit_status", { clientId: "cli_okoro" }],
      ["list_visits", {}],
      ["list_exceptions", {}],
      ["explain_visit", { visitId: "v_okoro_26" }],
      ["get_client_summary", { clientId: "cli_nakamura", range: "week" }],
    ] as const) {
      const result = await session.call(name, args)
      expect(result.isError).toBeFalsy()
      const spoken = (result.structuredContent as { spoken: string }).spoken
      expect(spoken.length).toBeGreaterThan(0)
      expect(result.content[0]).toEqual({ type: "text", text: spoken })
    }
  })

  it("answers the voice question honestly over the wire", async () => {
    const session = await openSession(server.url)
    const result = await session.call("get_visit_status", { clientId: "cli_okoro" })
    expect((result.structuredContent as { spoken: string }).spoken).toContain("someone arrived at the door at 8:04 AM ET")
  })

  it("asks for confirmation on writes when the client has no elicitation, then writes with confirmed", async () => {
    const session = await openSession(server.url)
    const first = await session.call("add_visit_note", { visitId: "v_okoro_27", text: "Running late today." })
    expect((first.structuredContent as { status: string }).status).toBe("confirmation_required")
    const second = await session.call("add_visit_note", { visitId: "v_okoro_27", text: "Running late today.", confirmed: true })
    expect(second.structuredContent).toMatchObject({ status: "done", confirmationMethod: "confirmed_argument" })
  })

  it("returns isError for unknown ids and unknown tools", async () => {
    const session = await openSession(server.url)
    const missing = await session.call("explain_visit", { visitId: "v_nope" })
    expect(missing.isError).toBe(true)
    const message = await session.request("tools/call", { name: "no_such_tool", arguments: {} })
    const error = message.error as { code: number } | undefined
    if (error) expect(error.code).toBeLessThan(0)
    else expect((message.result as { isError?: boolean }).isError).toBe(true)
  })

  it("serves the schedule resource template and the morning_briefing prompt", async () => {
    const session = await openSession(server.url)
    const templates = await session.request("resources/templates/list", {})
    const uris = (templates.result as { resourceTemplates: Array<{ uriTemplate: string }> }).resourceTemplates.map((t) => t.uriTemplate)
    expect(uris).toContain("visitproof://schedule/{clientId}/{date}")
    const read = await session.request("resources/read", { uri: "visitproof://schedule/cli_okoro/2026-09-27" })
    const contents = (read.result as { contents: Array<{ mimeType: string; text: string }> }).contents
    expect(contents[0]?.mimeType).toBe("application/json")
    expect((JSON.parse(contents[0]!.text) as { visits: unknown[] }).visits).toHaveLength(2)
    const listed = await session.request("resources/list", {})
    expect((listed.result as { resources: unknown[] }).resources).toHaveLength(3)
    const prompts = await session.request("prompts/list", {})
    expect((prompts.result as { prompts: Array<{ name: string }> }).prompts.map((p) => p.name)).toEqual(["morning_briefing"])
    const prompt = await session.request("prompts/get", { name: "morning_briefing", arguments: { clientId: "cli_okoro" } })
    expect(JSON.stringify(prompt.result)).toContain("get_visit_status")
  })
})
