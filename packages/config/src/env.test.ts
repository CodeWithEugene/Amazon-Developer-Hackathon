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
})
