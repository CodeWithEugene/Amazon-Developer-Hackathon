import type { Persona } from "./types"

/**
 * Picks the demo bearer token for a persona from MCP_DEMO_TOKENS
 * ("family-demo-token=family:cli_okoro,agency-demo-token=agency"). Mirrors
 * the server's parser in apps/mcp/src/auth.ts; the two legacy bare names
 * keep their conventional scopes. Returns undefined when none matches.
 */
const LEGACY: Readonly<Record<string, string>> = {
  "family-demo-token": "family:cli_okoro",
  "agency-demo-token": "agency",
}

export const DEFAULT_DEMO_TOKENS = "family-demo-token=family:cli_okoro,agency-demo-token=agency"

export interface DemoTokenChoice {
  readonly token: string
  readonly scope: string
}

export function demoTokenFor(persona: Persona, raw: string | undefined): DemoTokenChoice | undefined {
  const entries = (raw && raw.trim() ? raw : DEFAULT_DEMO_TOKENS)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const [token = "", scope] = entry.split("=").map((part) => part.trim())
      return { token, scope: scope ?? LEGACY[token] ?? "" }
    })
  return entries.find((entry) => (persona === "agency" ? entry.scope === "agency" : entry.scope.startsWith("family:")))
}
