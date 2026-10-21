import { localDateKey } from "@visitproof/domain"
import { describe, expect, it } from "vitest"

import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { dotenvPassthrough, readDemoConfig } from "../config"
import { bindTest, isPortFree } from "../ports"
import { demoWindow, windowStart } from "../window"

describe("demo window", () => {
  it("puts day 13 on today's agency-local date", () => {
    const now = Date.UTC(2026, 8, 29, 2, 30) // 10:30 PM on Sep 28 in New York
    expect(new Date(windowStart(now, 0)).toISOString()).toBe(
      "2026-09-28T00:00:00.000Z"
    )
    const { replay, complete } = demoWindow(now, "end", "k")
    expect(
      localDateKey(
        new Date(replay.visits.at(-1)!.scheduledStartAt).toISOString(),
        "America/New_York"
      )
    ).toBe("2026-09-28")
    expect(complete).toBe(true)
  })

  it("stops at the wall clock when asked", () => {
    const now = Date.UTC(2026, 8, 28, 15)
    const window = demoWindow(now, "now", "k")
    expect(window.to).toBe(now)
    expect(window.complete).toBe(false)
  })
})

describe("demo config", () => {
  it("honors port and store overrides and refuses duplicate ports", () => {
    // VISITPROOF_DEMO_DOTENV=0 keeps the tests away from the repository's .env.
    const off = { VISITPROOF_DEMO_DOTENV: "0" }
    const config = readDemoConfig({
      ...off,
      PORT: "3220",
      WEBHOOK_PORT: "3221",
      MCP_PORT: "3222",
      VISITPROOF_DEMO_STORE_PATH: "/tmp/x",
    })
    expect([
      config.consolePort,
      config.webhookPort,
      config.mcpPort,
      config.storeDir,
    ]).toEqual([3220, 3221, 3222, "/tmp/x"])
    expect(config.passthrough).toEqual({})
    expect(readDemoConfig(off).mcpPort).toBe(8000)
    expect(() =>
      readDemoConfig({ ...off, PORT: "3220", WEBHOOK_PORT: "3220" })
    ).toThrow(/must differ/)
  })

  it("takes only the Ring keys from .env, and never overrides the shell", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-demo-dotenv-"))
    await writeFile(
      join(root, ".env"),
      "RING_PLAYGROUND_ACCESS_TOKEN=tok\nAWS_SECRET_ACCESS_KEY=nope\nMODEL_PROVIDER=bedrock\nRING_API_BASE=https://api.example\n"
    )
    expect(dotenvPassthrough(root, {})).toEqual({
      RING_PLAYGROUND_ACCESS_TOKEN: "tok",
      RING_API_BASE: "https://api.example",
    })
    expect(dotenvPassthrough(root, { RING_API_BASE: "https://shell" })).toEqual(
      { RING_PLAYGROUND_ACCESS_TOKEN: "tok" }
    )
    expect(dotenvPassthrough(root, { VISITPROOF_DEMO_DOTENV: "0" })).toEqual({})
    expect(dotenvPassthrough(join(root, "missing"), {})).toEqual({})
  })
})

describe("port preflight", () => {
  it("sees a port as taken while something listens on it", async () => {
    const { createServer } = await import("node:net")
    const server = createServer()
    await new Promise<void>((resolve) =>
      server.listen(3290, "127.0.0.1", resolve)
    )
    try {
      expect(await bindTest(3290, "127.0.0.1")).toBe("in_use")
      expect(await isPortFree(3290)).toBe(false)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
    expect(await isPortFree(3290)).toBe(true)
  })
})
