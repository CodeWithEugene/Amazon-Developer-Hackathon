import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import {
  isInitializeRequest,
  isJSONRPCNotification,
} from "@modelcontextprotocol/sdk/types.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express, { type Express, type Request, type Response } from "express"
import { DEMO_REPO, type VisitRepository } from "./repo"
import { MCP_INSTRUCTIONS, registerTools, type ToolContext } from "./tools"

export const MCP_SERVER_NAME = "visitproof"
export const MCP_SERVER_VERSION = "0.1.0"

export interface CreateHttpAppOptions {
  /** Repository accessor injected into the tools (defaults to the demo fixtures). */
  repo?: VisitRepository
  /** Clock injected into the tools (defaults to real time). */
  now?: () => Date
  /**
   * Bearer tokens accepted on /mcp (demo mode). When omitted, tokens are read
   * from MCP_DEMO_TOKENS; when that is unset too, /mcp is open (local dev).
   */
  tokens?: string[]
}

export const createMcpServer = (): McpServer =>
  new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: MCP_INSTRUCTIONS },
  )

const demoTokensFromEnv = (): string[] =>
  (process.env.MCP_DEMO_TOKENS ?? "")
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

type Session = {
  server: McpServer
  transport: StreamableHTTPServerTransport
}

const ERROR_UNAUTHORIZED = {
  jsonrpc: "2.0" as const,
  id: null,
  error: { code: -32000, message: "Unauthorized" },
}

/** Express app exposing `POST/GET/DELETE /mcp` (Streamable HTTP) and `/health`. */
export const createHttpApp = (options: CreateHttpAppOptions = {}): Express => {
  const repo = options.repo ?? DEMO_REPO
  const context: ToolContext = { repo, now: options.now }
  const tokens = options.tokens ?? demoTokensFromEnv()

  const app = express()
  app.use(express.json({ limit: "1mb" }))

  const sessions = new Map<string, Session>()

  const unauthorized = (response: Response) => {
    response
      .status(401)
      .set("WWW-Authenticate", 'Bearer realm="visitproof"')
      .json(ERROR_UNAUTHORIZED)
  }

  /**
   * Constant-time token membership. Both sides are hashed first so the
   * compare is length-independent and the timing leaks nothing about how
   * much of a token prefix was correct.
   */
  const tokenDigest = (token: string) =>
    createHash("sha256").update(token).digest()
  const trusted = tokens.map(tokenDigest)
  const tokenMatches = (candidate: string): boolean => {
    const digest = tokenDigest(candidate)
    return trusted.some((known) => timingSafeEqual(known, digest))
  }

  const requireBearer = (request: Request): boolean => {
    if (tokens.length === 0) return true
    const header = request.headers.authorization
    if (!header?.startsWith("Bearer ")) return false
    return tokenMatches(header.slice("Bearer ".length).trim())
  }

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "mcp" })
  })

  const handleSessionRequest = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const sessionId = request.headers["mcp-session-id"]
    const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
    const session = id ? sessions.get(id) : undefined
    if (session) {
      await session.transport.handleRequest(request, response, request.body)
      return
    }
    if (id) {
      response.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Session not found" },
        id: null,
      })
      return
    }
    // No session id: only initialization may start a new session.
    if (isInitializeRequest(request.body)) {
      await startSession(request, response)
      return
    }
    response.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32002, message: "Bad Request: no valid session" },
      id: isJSONRPCNotification(request.body) ? null : request.body?.id ?? null,
    })
  }

  const startSession = async (
    request: Request,
    response: Response,
  ): Promise<void> => {
    const sessionId = randomUUID()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId,
      enableJsonResponse: false,
    })
    const server = createMcpServer()
    registerTools(server, context)
    transport.onclose = () => {
      if (sessions.get(sessionId)?.transport === transport) {
        sessions.delete(sessionId)
      }
    }
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
    sessions.set(sessionId, { server, transport })
  }

  app.post("/mcp", async (request, response, next) => {
    if (!requireBearer(request)) {
      unauthorized(response)
      return
    }
    try {
      await handleSessionRequest(request, response)
    } catch (error) {
      next(error)
    }
  })

  app.get("/mcp", async (request, response, next) => {
    if (!requireBearer(request)) {
      unauthorized(response)
      return
    }
    try {
      const sessionId = request.headers["mcp-session-id"]
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      const session = id ? sessions.get(id) : undefined
      if (!session) {
        response.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        })
        return
      }
      await session.transport.handleRequest(request, response)
    } catch (error) {
      next(error)
    }
  })

  app.delete("/mcp", async (request, response, next) => {
    if (!requireBearer(request)) {
      unauthorized(response)
      return
    }
    try {
      const sessionId = request.headers["mcp-session-id"]
      const id = Array.isArray(sessionId) ? sessionId[0] : sessionId
      const session = id ? sessions.get(id) : undefined
      if (!session) {
        response.status(404).json({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        })
        return
      }
      await session.transport.handleRequest(request, response)
    } catch (error) {
      next(error)
    }
  })

  // JSON body parse failures and unexpected errors leave JSON-RPC in the body.
  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      next: () => void,
    ) => {
      const message = error instanceof Error ? error.message : "Bad Request"
      if (response.headersSent) {
        next()
        return
      }
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32700, message: `Parse error: ${message}` },
        id: null,
      })
    },
  )

  return app
}
