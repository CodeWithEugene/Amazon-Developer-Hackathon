import { randomUUID } from "node:crypto"

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest, isJSONRPCNotification } from "@modelcontextprotocol/sdk/types.js"
import { parseEnv, type EnvSource } from "@visitproof/config/env"
import express, { type Express, type NextFunction, type Request, type Response } from "express"

import { createAuthenticator, parseDemoTokens, type AccessTokenVerifier, type Principal } from "./auth"
import {
  authMiddleware,
  authOf,
  PROTECTED_RESOURCE_PATH,
  protectedResourceMetadata,
  type ProtectedResourceConfig,
} from "./auth-http"
import { DEMO_REPO, type VisitRepository } from "./repo"
import { originGuard, originPolicyFromEnv, type OriginPolicy } from "./security"
import { DEFAULT_SESSION_LIMITS, SessionRegistry, type SessionLimits } from "./sessions"
import { DEMO_LEDGER_SIGNER, type LedgerSignerConfig } from "./signer"
import { MCP_INSTRUCTIONS, registerPrompts, registerResources, registerTools, type ToolContext } from "./tools"

export const MCP_SERVER_NAME = "visitproof"
export const MCP_SERVER_VERSION = "0.2.0"

export interface CreateHttpAppOptions {
  /** Repository accessor injected into the tools (defaults to the fixture world). */
  repo?: VisitRepository
  /** Clock injected into the tools (defaults to real time). */
  now?: () => Date
  /**
   * Demo bearer tokens as "token=scope" entries (scope "agency" or
   * "family:<clientId>"). Defaults to MCP_DEMO_TOKENS. Honored only in demo mode.
   */
  tokens?: string[]
  /** VISITPROOF_MODE; defaults to the environment (demo). */
  mode?: "demo" | "live"
  /** Demo mode only: treat requests without a token as the agency (local development). */
  allowAnonymous?: boolean
  /** Verifies non-demo access tokens (Cognito JWTs in production). */
  verifyAccessToken?: AccessTokenVerifier
  originPolicy?: OriginPolicy
  protectedResource?: ProtectedResourceConfig
  /** Ledger signer for the write tools; the local HMAC stand-in in demo mode. */
  signer?: LedgerSignerConfig
  /** Stateless Streamable HTTP (serverless): fresh server per request, JSON responses. */
  stateless?: boolean
  sessionLimits?: SessionLimits
  /** Environment used for the defaults above (defaults to process.env). */
  env?: EnvSource
}

export const createMcpServer = (): McpServer =>
  new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION }, { instructions: MCP_INSTRUCTIONS })

const CONFIRM_SCHEMA = {
  type: "object" as const,
  properties: { confirm: { type: "boolean" as const, title: "Confirm", description: "Yes, do it" } },
  required: ["confirm"],
}

/** Builds a server bound to one principal, with elicitation when the client supports it. */
const buildServer = (base: Omit<ToolContext, "principal" | "elicit">, principal: Principal): McpServer => {
  const server = createMcpServer()
  const elicit = async (message: string) => {
    const result = await server.server.elicitInput({ mode: "form", message, requestedSchema: CONFIRM_SCHEMA })
    return result.action === "accept" && result.content?.confirm === true ? ("accepted" as const) : ("declined" as const)
  }
  const context: ToolContext = {
    ...base,
    principal,
    get elicit() {
      return server.server.getClientCapabilities()?.elicitation ? elicit : undefined
    },
  }
  registerTools(server, context)
  registerResources(server, context)
  registerPrompts(server)
  return server
}

const rpcError = (response: Response, status: number, code: number, message: string, id: unknown = null) =>
  response.status(status).json({ jsonrpc: "2.0", id, error: { code, message } })

const sessionIdOf = (request: Request): string | undefined => {
  const header = request.headers["mcp-session-id"]
  return Array.isArray(header) ? header[0] : header
}

interface ResolvedConfig {
  mode: "demo" | "live"
  protectedResource: ProtectedResourceConfig
  originPolicy: OriginPolicy
}

const resolveConfig = (options: CreateHttpAppOptions, env: EnvSource): ResolvedConfig => {
  const parsed = parseEnv(env)
  return {
    mode: options.mode ?? parsed.VISITPROOF_MODE,
    protectedResource: options.protectedResource ?? {
      ...(env.MCP_PUBLIC_URL ? { resourceUrl: parsed.MCP_PUBLIC_URL } : {}),
      authorizationServers: parsed.MCP_AUTH_ISSUER ? [parsed.MCP_AUTH_ISSUER] : [],
    },
    originPolicy: options.originPolicy ?? originPolicyFromEnv(env),
  }
}

/** Express app exposing `POST/GET/DELETE /mcp` (Streamable HTTP), `/health`, and OAuth metadata. */
export const createHttpApp = (options: CreateHttpAppOptions = {}): Express => {
  const env = options.env ?? process.env
  const config = resolveConfig(options, env)
  const authenticate = createAuthenticator({
    mode: config.mode,
    demoTokens: parseDemoTokens(options.tokens ?? parseEnv(env).MCP_DEMO_TOKENS),
    allowAnonymous: options.allowAnonymous ?? (env.MCP_ALLOW_ANONYMOUS === "1"),
    ...(options.verifyAccessToken ? { verifyAccessToken: options.verifyAccessToken } : {}),
  })
  const signer = options.signer ?? (config.mode === "demo" ? DEMO_LEDGER_SIGNER : undefined)
  const base = { repo: options.repo ?? DEMO_REPO, ...(options.now ? { now: options.now } : {}), ...(signer ? { signer } : {}) }
  const sessions = new SessionRegistry(options.sessionLimits ?? DEFAULT_SESSION_LIMITS)
  const guard = [originGuard(config.originPolicy), authMiddleware(authenticate, config.protectedResource)]

  const app = express()
  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "mcp", mode: config.mode, stateless: Boolean(options.stateless), sessions: sessions.size })
  })
  const metadata = (request: Request, response: Response) => {
    response.json(protectedResourceMetadata(config.protectedResource, request))
  }
  app.get(PROTECTED_RESOURCE_PATH, metadata)
  app.get(`${PROTECTED_RESOURCE_PATH}/mcp`, metadata)

  const handlePost = options.stateless ? statelessPost(base) : statefulPost(base, sessions)
  app.post("/mcp", ...guard, express.json({ limit: "1mb" }), wrap(handlePost))
  app.get("/mcp", ...guard, wrap(options.stateless ? methodNotAllowed : existingSession(sessions)))
  app.delete("/mcp", ...guard, wrap(options.stateless ? methodNotAllowed : existingSession(sessions)))
  app.use(errorHandler)
  return app
}

type Handler = (request: Request, response: Response) => Promise<void>

const wrap =
  (handler: Handler) =>
  (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response).catch(next)
  }

const methodNotAllowed: Handler = async (_request, response) => {
  response.set("Allow", "POST")
  rpcError(response, 405, -32000, "Method not allowed in stateless mode")
}

const statefulPost =
  (base: Omit<ToolContext, "principal" | "elicit">, sessions: SessionRegistry): Handler =>
  async (request, response) => {
    const auth = authOf(response)
    const id = sessionIdOf(request)
    if (id) {
      const session = sessions.get(id)
      if (!session) return void rpcError(response, 404, -32001, "Session not found")
      if (session.sessionKey !== auth.sessionKey) return void rpcError(response, 403, -32000, "Forbidden: session belongs to a different credential")
      await session.transport.handleRequest(request, response, request.body)
      return
    }
    if (!isInitializeRequest(request.body)) {
      const rpcId = isJSONRPCNotification(request.body) ? null : (request.body as { id?: unknown } | undefined)?.id ?? null
      return void rpcError(response, 400, -32002, "Bad Request: no valid session", rpcId)
    }
    const sessionId = randomUUID()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => sessionId, enableJsonResponse: false })
    const server = buildServer(base, auth.principal)
    transport.onclose = () => sessions.remove(sessionId, transport)
    await server.connect(transport)
    await sessions.add(sessionId, { server, transport, sessionKey: auth.sessionKey })
    await transport.handleRequest(request, response, request.body)
  }

const statelessPost =
  (base: Omit<ToolContext, "principal" | "elicit">): Handler =>
  async (request, response) => {
    const auth = authOf(response)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    const server = buildServer(base, auth.principal)
    response.on("close", () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
  }

const existingSession =
  (sessions: SessionRegistry): Handler =>
  async (request, response) => {
    const auth = authOf(response)
    const id = sessionIdOf(request)
    const session = id ? sessions.get(id) : undefined
    if (!session) return void rpcError(response, 404, -32001, "Session not found")
    if (session.sessionKey !== auth.sessionKey) return void rpcError(response, 403, -32000, "Forbidden: session belongs to a different credential")
    await session.transport.handleRequest(request, response)
  }

/** JSON body parse failures are 400 -32700; anything else is a 500 with no internals. */
const errorHandler = (error: unknown, _request: Request, response: Response, next: NextFunction): void => {
  if (response.headersSent) {
    next(error)
    return
  }
  const parseFailure = typeof error === "object" && error !== null && (error as { type?: string }).type === "entity.parse.failed"
  if (parseFailure) {
    rpcError(response, 400, -32700, "Parse error: invalid JSON")
    return
  }
  process.stderr.write(`[mcp] request failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  rpcError(response, 500, -32603, "Internal error")
}
