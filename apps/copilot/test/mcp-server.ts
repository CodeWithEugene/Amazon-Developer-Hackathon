import type { Server } from "node:http"

import { createHttpApp } from "@visitproof/mcp"
import { createFixtureRepository, DEMO_NOW } from "@visitproof/mcp/repo"

export { DEMO_NOW }

export interface RunningMcp {
  readonly url: string
  close(): Promise<void>
}

/** A real VisitProof MCP server over the fixture world, on an ephemeral loopback port. */
export async function startMcp(): Promise<RunningMcp> {
  const app = createHttpApp({
    repo: createFixtureRepository(),
    now: () => DEMO_NOW,
    mode: "demo",
    tokens: ["family-demo-token=family:cli_okoro", "agency-demo-token=agency"],
    env: {},
  })
  const server: Server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve) => server.once("listening", resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
