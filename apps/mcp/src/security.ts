import type { NextFunction, Request, Response } from "express"

/**
 * DNS-rebinding protection for the Streamable HTTP endpoint (MCP spec,
 * transports: servers MUST validate Origin). Host is checked by hostname
 * against an allow-list, and a present Origin must match an allowed origin
 * exactly; requests without Origin (non-browser clients such as Alexa+, the
 * Strands agent, or curl) pass the Origin check.
 */
export interface OriginPolicy {
  readonly allowedHosts: readonly string[]
  readonly allowedOrigins: readonly string[]
}

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]", "::1"]
const LOCAL_CONSOLE_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]

const list = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

const originOf = (url: string | undefined): string[] => {
  if (!url) return []
  try {
    return [new URL(url).origin]
  } catch {
    throw new Error(`Invalid URL in MCP origin policy configuration: ${url}`)
  }
}

const hostnameOf = (url: string | undefined): string[] => {
  if (!url) return []
  return [new URL(url).hostname]
}

export interface OriginPolicyEnv {
  readonly MCP_PUBLIC_URL?: string
  readonly NEXT_PUBLIC_APP_URL?: string
  readonly MCP_ALLOWED_HOSTS?: string
  readonly MCP_ALLOWED_ORIGINS?: string
}

/** Loopback plus the public MCP host, the console origin, and explicit extras. */
export const originPolicyFromEnv = (env: OriginPolicyEnv): OriginPolicy => ({
  allowedHosts: [...new Set([...LOOPBACK_HOSTS, ...hostnameOf(env.MCP_PUBLIC_URL), ...list(env.MCP_ALLOWED_HOSTS)])],
  allowedOrigins: [
    ...new Set([
      ...LOCAL_CONSOLE_ORIGINS,
      ...originOf(env.NEXT_PUBLIC_APP_URL),
      ...originOf(env.MCP_PUBLIC_URL),
      ...list(env.MCP_ALLOWED_ORIGINS),
    ]),
  ],
})

/** Hostname of a Host header value, keeping IPv6 brackets. */
export const hostnameFromHeader = (host: string): string => {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1)
  return host.split(":")[0] ?? host
}

const forbidden = (response: Response, message: string) =>
  response.status(403).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } })

export const originGuard =
  (policy: OriginPolicy) =>
  (request: Request, response: Response, next: NextFunction): void => {
    const host = request.headers.host
    if (!host || !policy.allowedHosts.includes(hostnameFromHeader(host))) {
      forbidden(response, `Forbidden: invalid Host header ${host ?? "(missing)"}`)
      return
    }
    const origin = request.headers.origin
    if (origin !== undefined && !policy.allowedOrigins.includes(origin)) {
      forbidden(response, `Forbidden: invalid Origin header ${origin}`)
      return
    }
    next()
  }
