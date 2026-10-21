import type { NextFunction, Request, Response } from "express"

import type { AuthOutcome, Principal } from "./auth"

/** Where the RFC 9728 protected-resource metadata lives for this server. */
export const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"

export interface ProtectedResourceConfig {
  /** Canonical MCP URL (MCP_PUBLIC_URL); derived from the request when unset. */
  readonly resourceUrl?: string
  /** Authorization servers (MCP_AUTH_ISSUER, the Cognito issuer). */
  readonly authorizationServers: readonly string[]
}

export interface AuthedLocals {
  principal: Principal
  sessionKey: string
}

const requestOrigin = (request: Request): string => `${request.protocol}://${request.headers.host ?? "localhost"}`

export const resourceUrlFor = (config: ProtectedResourceConfig, request: Request): string =>
  config.resourceUrl ?? `${requestOrigin(request)}/mcp`

export const metadataUrlFor = (config: ProtectedResourceConfig, request: Request): string =>
  `${new URL(resourceUrlFor(config, request)).origin}${PROTECTED_RESOURCE_PATH}`

/** RFC 9728 protected-resource metadata document. */
export const protectedResourceMetadata = (config: ProtectedResourceConfig, request: Request) => ({
  resource: resourceUrlFor(config, request),
  authorization_servers: [...config.authorizationServers],
  bearer_methods_supported: ["header"],
  scopes_supported: ["agency", "family"],
  resource_name: "VisitProof",
})

/**
 * 401 that works for both client styles: a plain Bearer challenge with a
 * realm (Alexa+ MCP Toolkit only needs the 401), plus `resource_metadata`
 * for RFC 9728 discovery and `error="invalid_token"` when a token was sent.
 */
export const sendUnauthorized = (
  response: Response,
  request: Request,
  config: ProtectedResourceConfig,
  tokenPresented: boolean,
): void => {
  const params = [
    'realm="visitproof"',
    `resource_metadata="${metadataUrlFor(config, request)}"`,
    ...(tokenPresented ? ['error="invalid_token"', 'error_description="The access token is not valid for this server"'] : []),
  ]
  response
    .status(401)
    .set("WWW-Authenticate", `Bearer ${params.join(", ")}`)
    .json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } })
}

export const authMiddleware =
  (authenticate: (authorization: string | undefined) => Promise<AuthOutcome>, config: ProtectedResourceConfig) =>
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    try {
      const outcome = await authenticate(request.headers.authorization)
      if (!outcome.ok) {
        sendUnauthorized(response, request, config, outcome.tokenPresented)
        return
      }
      const locals: AuthedLocals = { principal: outcome.principal, sessionKey: outcome.sessionKey }
      response.locals.auth = locals
      next()
    } catch (error) {
      next(error)
    }
  }

export const authOf = (response: Response): AuthedLocals => {
  const auth = response.locals.auth as AuthedLocals | undefined
  if (!auth) throw new Error("auth middleware did not run for this route")
  return auth
}
