import { createHash, timingSafeEqual } from "node:crypto"

import { z } from "zod"

/**
 * Who is calling. A family principal is bound to one client; the agency
 * principal sees the agency's clients (subject to family consent).
 */
export type Principal =
  | { readonly kind: "agency"; readonly subject: string }
  | { readonly kind: "family"; readonly subject: string; readonly clientId: string }

export const AGENCY_PRINCIPAL: Principal = { kind: "agency", subject: "agency" }

/** "agency" or "family:<clientId>". */
export const scopeSchema = z.union([
  z.literal("agency"),
  z.string().regex(/^family:[A-Za-z0-9_-]+$/, "family scope must be family:<clientId>"),
])
export type Scope = z.infer<typeof scopeSchema>

export interface DemoToken {
  readonly token: string
  readonly scope: Scope
}

/**
 * The two names published in .env.example and the config default. A bare
 * entry with one of these names gets this scope; any other bare entry is a
 * configuration error, so an unscoped token can never grant access.
 */
export const LEGACY_DEMO_SCOPES: Readonly<Record<string, Scope>> = {
  "family-demo-token": "family:cli_okoro",
  "agency-demo-token": "agency",
}

export const DEFAULT_DEMO_TOKENS = "family-demo-token=family:cli_okoro,agency-demo-token=agency"

/** Parses MCP_DEMO_TOKENS entries such as "family-demo-token=family:cli_okoro". */
export const parseDemoTokens = (raw: string | readonly string[]): DemoToken[] => {
  const entries = (typeof raw === "string" ? raw.split(",") : [...raw])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.map((entry) => {
    const separator = entry.indexOf("=")
    const token = (separator === -1 ? entry : entry.slice(0, separator)).trim()
    const scopeText = separator === -1 ? LEGACY_DEMO_SCOPES[token] : entry.slice(separator + 1).trim()
    if (!token || !scopeText) {
      throw new Error(`MCP_DEMO_TOKENS entry "${token || entry}" needs a scope, for example ${token || "name"}=agency`)
    }
    const scope = scopeSchema.safeParse(scopeText)
    if (!scope.success) {
      throw new Error(`MCP_DEMO_TOKENS entry "${token}" has an invalid scope "${scopeText}"`)
    }
    return { token, scope: scope.data }
  })
}

export const principalForScope = (scope: Scope, subject: string): Principal =>
  scope === "agency"
    ? { kind: "agency", subject }
    : { kind: "family", subject, clientId: scope.slice("family:".length) }

/** Verifies a bearer token issued by the authorization server (Cognito JWT in production). */
export type AccessTokenVerifier = (token: string) => Promise<Principal | null>

export interface AuthConfig {
  readonly mode: "demo" | "live"
  readonly demoTokens: readonly DemoToken[]
  /** Demo mode only: accept requests without a token as the agency principal. */
  readonly allowAnonymous: boolean
  readonly verifyAccessToken?: AccessTokenVerifier
}

export type AuthOutcome =
  | { readonly ok: true; readonly principal: Principal; readonly sessionKey: string }
  | { readonly ok: false; readonly tokenPresented: boolean }

const digest = (value: string) => createHash("sha256").update(value).digest()

/**
 * Resolves the caller. Demo tokens are honored only in demo mode; digests are
 * compared in constant time so timing reveals nothing about a token prefix.
 */
export const createAuthenticator = (config: AuthConfig) => {
  const demo = config.mode === "demo" ? config.demoTokens.map((entry) => ({ ...entry, digest: digest(entry.token) })) : []

  return async (authorization: string | undefined): Promise<AuthOutcome> => {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : ""
    if (!token) {
      if (config.mode === "demo" && config.allowAnonymous) {
        return { ok: true, principal: AGENCY_PRINCIPAL, sessionKey: "anonymous" }
      }
      return { ok: false, tokenPresented: Boolean(authorization) }
    }
    const candidate = digest(token)
    const match = demo.find((entry) => timingSafeEqual(entry.digest, candidate))
    if (match) {
      return {
        ok: true,
        principal: principalForScope(match.scope, `demo:${match.token}`),
        sessionKey: candidate.toString("hex"),
      }
    }
    const verified = config.verifyAccessToken ? await config.verifyAccessToken(token) : null
    return verified
      ? { ok: true, principal: verified, sessionKey: candidate.toString("hex") }
      : { ok: false, tokenPresented: true }
  }
}
