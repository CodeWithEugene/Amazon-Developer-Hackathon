/**
 * The long-running demo services after the replay: the MCP server (Ask
 * VisitProof's tools, contract C7) and the console, both over the seeded
 * local store. Everything stays local: the store is forced to the JSON
 * repository and the Ask brain to the offline fixture unless the person
 * running the demo chose otherwise.
 */
import type { DemoConfig } from "./config"
import { AGENCY_ID } from "./config"
import {
  anyResponse,
  serviceNamed,
  startService,
  waitForService,
} from "./processes"

const MCP_TIMEOUT_MS = 60_000
const CONSOLE_TIMEOUT_MS = 240_000

const consoleOrigin = (config: DemoConfig): string =>
  `http://localhost:${config.consolePort}`
export const mcpUrl = (config: DemoConfig): string =>
  `http://localhost:${config.mcpPort}/mcp`

const sharedEnv = (config: DemoConfig): Record<string, string> => ({
  VISITPROOF_MODE: "demo",
  VISITPROOF_STORE: "local",
  VISITPROOF_DEMO_STORE_PATH: config.storeDir,
  VISITPROOF_DEMO_AGENCY_ID: AGENCY_ID,
  VISITPROOF_LEDGER_SECRET: config.ledgerSecret,
  NEXT_PUBLIC_APP_URL: consoleOrigin(config),
  MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? "fixture",
})

export async function startMcp(config: DemoConfig): Promise<void> {
  const service = startService(
    "mcp",
    ["--filter", "@visitproof/mcp", "exec", "tsx", "src/server.ts"],
    {
      ...sharedEnv(config),
      MCP_PORT: String(config.mcpPort),
      MCP_HOST: "127.0.0.1",
    },
    config.root
  )
  await waitForService(
    service,
    `http://localhost:${config.mcpPort}/health`,
    serviceNamed("mcp"),
    MCP_TIMEOUT_MS
  )
}

export async function startConsole(config: DemoConfig): Promise<void> {
  const service = startService(
    "console",
    [
      "--filter",
      "@visitproof/console",
      "exec",
      "next",
      "dev",
      "-p",
      String(config.consolePort),
    ],
    {
      ...config.passthrough,
      ...sharedEnv(config),
      MCP_URL: mcpUrl(config),
      NEXT_TELEMETRY_DISABLED: "1",
    },
    config.root
  )
  await waitForService(
    service,
    consoleOrigin(config),
    anyResponse,
    CONSOLE_TIMEOUT_MS
  )
}

export function readyBanner(
  config: DemoConfig,
  pids: Readonly<Record<string, number | undefined>>
): string {
  const pid = (name: string) => (pids[name] ? ` (pid ${pids[name]})` : "")
  return [
    "",
    "VisitProof demo is ready.",
    `  Console:  ${consoleOrigin(config)}${pid("console")}`,
    `  Webhooks: http://localhost:${config.webhookPort}/health${pid("webhooks")} (signed receiver, same store)`,
    `  MCP:      ${mcpUrl(config)}${pid("mcp")} (Ask VisitProof tools, same store)`,
    `  Store:    ${config.storeDir}`,
    "",
    "Sign in with one click as: Scheduler (Today board and exception cards),",
    "Compliance Lead (reconciliation, evidence pack PDF, Open EVV Style export),",
    "Family Member (Grace Okoro's feed, devices, live view), or Caregiver (own visit record).",
    "Ask VisitProof is at /ask for the Family Member and agency roles.",
    "",
    "Ctrl+C stops every service this demo started.",
    "",
  ].join("\n")
}
