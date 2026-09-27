import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Server } from "node:http"
import { createHttpApp } from "../../src/index"
import { DEMO_NOW } from "../../src/repo"

let server: Server
let baseUrl: string
let authServer: Server
let authBaseUrl: string

beforeAll(async () => {
  server = createHttpApp({ now: () => DEMO_NOW }).listen(0)
  await new Promise<void>((resolve) => server.once("listening", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  authServer = createHttpApp({
    now: () => DEMO_NOW,
    tokens: ["family-demo-token"],
  }).listen(0)
  await new Promise<void>((resolve) => authServer.once("listening", resolve))
  authBaseUrl = `http://127.0.0.1:${
    (authServer.address() as { port: number }).port
  }`
})

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
  await new Promise<void>((resolve) => {
    authServer.closeAllConnections?.()
    authServer.close(() => resolve())
  })
})

interface RpcResult {
  status: number
  contentType: string
  sessionId?: string
  body: string
}

/** Posts a raw string body so malformed JSON can be tested. */
async function postRaw(
  url: string,
  body: string,
  sessionId?: string,
  token?: string,
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }
  if (sessionId) headers["mcp-session-id"] = sessionId
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    headers,
    body,
  })
  const text = await response.text()
  const sid = response.headers.get("mcp-session-id") ?? undefined
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    sessionId: sid,
    body: text,
  }
}

/** Parses the first JSON-RPC message from a JSON or SSE (event-stream) body. */
function firstMessage(result: RpcResult): Record<string, unknown> {
  if (result.contentType.includes("application/json")) {
    return JSON.parse(result.body) as Record<string, unknown>
  }
  for (const line of result.body.split("\n")) {
    if (line.startsWith("data:")) {
      return JSON.parse(line.slice(5).trim()) as Record<string, unknown>
    }
  }
  throw new Error(`no JSON-RPC message in body: ${result.body}`)
}

const rpc = (
  method: string,
  params: Record<string, unknown> | undefined,
  id: number | string,
) => JSON.stringify({ jsonrpc: "2.0", id, method, params })

let sessionId: string

describe("MCP conformance (Streamable HTTP, 2025-11-25)", () => {
  it("initializes with 2025-11-25 and returns a session id", async () => {
    const result = await postRaw(
      baseUrl,
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "conformance", version: "0.0.0" },
      }, 1),
    )
    expect(result.status).toBe(200)
    expect(result.sessionId).toBeTruthy()
    sessionId = result.sessionId as string
    const message = firstMessage(result)
    expect(message.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "visitproof" },
    })
    expect(
      ((message.result as { instructions?: string }).instructions ?? ""),
    ).toContain("spoken")
  })

  it("negotiates the 2025-03-26 protocol version", async () => {
    const result = await postRaw(
      baseUrl,
      rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "conformance", version: "0.0.0" },
      }, 2),
    )
    expect(result.status).toBe(200)
    expect(
      (firstMessage(result).result as { protocolVersion: string })
        .protocolVersion,
    ).toBe("2025-03-26")
  })

  it("accepts an initialized notification with 202", async () => {
    const result = await postRaw(
      baseUrl,
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      sessionId,
    )
    expect(result.status).toBe(202)
  })

  it("lists the five voice-first tools", async () => {
    const result = await postRaw(
      baseUrl,
      rpc("tools/list", {}, 3),
      sessionId,
    )
    const message = firstMessage(result)
    const tools = (
      (message.result as { tools: Array<{ name: string }> }).tools
    ).map((tool) => tool.name)
    expect(tools).toEqual([
      "did_the_caregiver_come_today",
      "visit_status",
      "today_exceptions",
      "visit_evidence",
      "export_evidence",
    ])
  })

  it("calls did_the_caregiver_come_today with structured spoken output", async () => {
    const result = await postRaw(
      baseUrl,
      rpc(
        "tools/call",
        {
          name: "did_the_caregiver_come_today",
          arguments: { clientId: "client-okoro" },
        },
        4,
      ),
      sessionId,
    )
    expect(result.status).toBe(200)
    const message = firstMessage(result)
    expect(message.error).toBeUndefined()
    const structured = (
      message.result as {
        structuredContent: { spoken: string; answer: string }
      }
    ).structuredContent
    expect(structured.answer).toBe("yes")
    expect(structured.spoken).toContain("10:02 AM")
  })

  it("calls visit_status, today_exceptions, visit_evidence, export_evidence", async () => {
    for (const [name, args] of [
      ["visit_status", { visitId: "visit-okoro-today" }],
      ["today_exceptions", {}],
      ["visit_evidence", { visitId: "visit-nakamura-today" }],
      ["export_evidence", { visitId: "visit-okoro-today" }],
    ] as const) {
      const result = await postRaw(
        baseUrl,
        rpc("tools/call", { name, arguments: args }, `call-${name}`),
        sessionId,
      )
      const message = firstMessage(result)
      expect(message.error).toBeUndefined()
      expect(
        (
          (message.result as { structuredContent: { spoken: string } })
            .structuredContent
        ).spoken.length,
      ).toBeGreaterThan(0)
    }
  })

  it("rejects an unknown method with -32601", async () => {
    const result = await postRaw(baseUrl, rpc("no/such/method", {}, 5), sessionId)
    expect(
      (firstMessage(result).error as { code: number }).code,
    ).toBe(-32601)
  })

  it("rejects an unknown tool (isError result or JSON-RPC error)", async () => {
    const result = await postRaw(
      baseUrl,
      rpc(
        "tools/call",
        { name: "no_such_tool", arguments: {} },
        6,
      ),
      sessionId,
    )
    const message = firstMessage(result)
    const error = message.error as { code: number } | undefined
    if (error) {
      expect(error.code).toBeLessThan(0)
    } else {
      const callResult = message.result as {
        isError?: boolean
        content: Array<{ text?: string }>
      }
      expect(callResult.isError).toBe(true)
      expect(JSON.stringify(callResult.content)).toContain("no_such_tool")
    }
  })

  it("returns 400 for malformed JSON", async () => {
    const result = await postRaw(baseUrl, "{not json", sessionId)
    expect(result.status).toBe(400)
  })

  it("returns 400 for a request without a session that is not initialize", async () => {
    const result = await postRaw(baseUrl, rpc("tools/list", {}, 7))
    expect(result.status).toBe(400)
  })

  it("returns 404 for an unknown session id", async () => {
    const result = await postRaw(
      baseUrl,
      rpc("tools/list", {}, 8),
      "99999999-9999-4999-8999-999999999999",
    )
    expect(result.status).toBe(404)
  })

  it("opens the GET /mcp SSE stream for a known session", async () => {
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/mcp`, {
      headers: {
        accept: "text/event-stream",
        "mcp-session-id": sessionId,
      },
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    controller.abort()
  })

  it("returns 401 when auth is configured and no token is sent", async () => {
    const result = await postRaw(
      authBaseUrl,
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "conformance", version: "0.0.0" },
      }, 9),
    )
    expect(result.status).toBe(401)
  })

  it("accepts a valid demo token when auth is configured", async () => {
    const result = await postRaw(
      authBaseUrl,
      rpc("initialize", {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "conformance", version: "0.0.0" },
      }, 10),
      undefined,
      "family-demo-token",
    )
    expect(result.status).toBe(200)
  })
})
