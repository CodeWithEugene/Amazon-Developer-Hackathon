import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

describe("parseEnv", () => {
  it("defaults to demo mode with fixture model provider when nothing is set", () => {
    const env = parseEnv({})

    expect(env.VISITPROOF_MODE).toBe("demo")
    expect(env.MODEL_PROVIDER).toBe("fixture")
    expect(env.RING_API_BASE).toBe("https://api.amazonvision.com")
  })

  it("treats empty strings from .env files as unset", () => {
    const env = parseEnv({ VISITPROOF_MODE: "", AWS_REGION: "" })

    expect(env.VISITPROOF_MODE).toBe("demo")
    expect(env.AWS_REGION).toBe("us-east-1")
  })

  it("rejects an unknown mode", () => {
    expect(() => parseEnv({ VISITPROOF_MODE: "staging" })).toThrow()
  })

  it("declares the demo, engine, and MCP settings with safe defaults", () => {
    const env = parseEnv({})

    expect(env.MCP_PORT).toBe(8000)
    expect(env.MCP_URL).toBe("http://localhost:8000/mcp")
    expect(env.MCP_DEMO_TOKENS).toBe("family-demo-token=family:cli_okoro,agency-demo-token=agency")
    expect(env.VISITPROOF_ENGINE_INLINE).toBe(true)
    expect(env.VISITPROOF_TIME_ZONE).toBe("America/New_York")
    expect(env.VISITPROOF_AGENCY_ID).toBe("a1")
    expect(env.WEBHOOK_PORT).toBe(3101)
  })

  it("parses the engine flag and rejects a malformed token key", () => {
    expect(parseEnv({ VISITPROOF_ENGINE_INLINE: "false" }).VISITPROOF_ENGINE_INLINE).toBe(false)
    const key = Buffer.alloc(32, 7).toString("base64")
    expect(parseEnv({ VISITPROOF_TOKEN_KEY: key }).VISITPROOF_TOKEN_KEY).toBe(key)
    expect(() => parseEnv({ VISITPROOF_TOKEN_KEY: "short" })).toThrow()
    expect(() => parseEnv({ MCP_PORT: "99999" })).toThrow()
  })
})
