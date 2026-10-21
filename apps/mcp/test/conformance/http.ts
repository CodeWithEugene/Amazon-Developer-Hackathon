import { request as httpRequest, type Server } from "node:http"

import type { Express } from "express"

export interface RpcResult {
  status: number
  contentType: string
  sessionId?: string
  headers: Headers
  body: string
}

export interface Running {
  url: string
  close(): Promise<void>
}

/** Listens on an ephemeral loopback port (never the demo ports). */
export async function listen(app: Express): Promise<Running> {
  const server: Server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}

export interface PostOptions {
  sessionId?: string
  token?: string
  headers?: Record<string, string>
}

/** Posts a raw string body so malformed JSON can be tested. */
export async function postRaw(url: string, body: string, options: PostOptions = {}): Promise<RpcResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...options.headers,
  }
  if (options.sessionId) headers["mcp-session-id"] = options.sessionId
  if (options.token) headers.authorization = `Bearer ${options.token}`
  const response = await fetch(`${url}/mcp`, { method: "POST", headers, body })
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    sessionId: response.headers.get("mcp-session-id") ?? undefined,
    headers: response.headers,
    body: await response.text(),
  }
}

/** Parses the first JSON-RPC message from a JSON or SSE (event-stream) body. */
export function firstMessage(result: RpcResult): Record<string, unknown> {
  if (result.contentType.includes("application/json")) {
    return JSON.parse(result.body) as Record<string, unknown>
  }
  for (const line of result.body.split("\n")) {
    if (line.startsWith("data:")) return JSON.parse(line.slice(5).trim()) as Record<string, unknown>
  }
  throw new Error(`no JSON-RPC message in body: ${result.body}`)
}

export const rpc = (method: string, params: Record<string, unknown> | undefined, id: number | string): string =>
  JSON.stringify({ jsonrpc: "2.0", id, method, params })

export const initialize = (id: number | string, protocolVersion = "2025-11-25"): string =>
  rpc("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "conformance", version: "0.0.0" } }, id)

export interface ToolCallResult {
  isError?: boolean
  content: Array<{ type: string; text?: string }>
  structuredContent?: Record<string, unknown>
}

/** Opens a session (initialize plus initialized) and returns a tool caller. */
export async function openSession(url: string, token?: string) {
  const init = await postRaw(url, initialize("init"), { token })
  if (!init.sessionId) throw new Error(`initialize failed: ${init.status} ${init.body}`)
  const sessionId = init.sessionId
  await postRaw(url, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), { sessionId, token })
  let counter = 0
  const request = async (method: string, params: Record<string, unknown>) => {
    counter += 1
    return firstMessage(await postRaw(url, rpc(method, params, `r${counter}`), { sessionId, token }))
  }
  return {
    sessionId,
    request,
    async call(name: string, args: Record<string, unknown> = {}): Promise<ToolCallResult> {
      const message = await request("tools/call", { name, arguments: args })
      if (message.error) throw new Error(`tools/call ${name} failed: ${JSON.stringify(message.error)}`)
      return message.result as ToolCallResult
    },
  }
}

/** fetch() always sends the real Host; a raw request can forge one, as a rebinding page would. */
export function postWithHost(url: string, host: string, body: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(`${url}/mcp`)
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          host,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.on("error", reject)
    req.end(body)
  })
}
