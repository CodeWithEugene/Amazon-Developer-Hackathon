import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { parseDemoTokens } from "../../src/auth"
import { createHttpApp } from "../../src/index"
import { createFixtureRepository, DEMO_NOW } from "../../src/repo"
import { firstMessage, initialize, listen, openSession, postRaw, postWithHost, rpc, type Running } from "./http"

const TOKENS = ["family-demo-token=family:cli_okoro", "agency-demo-token=agency"]
let demo: Running
let live: Running

beforeAll(async () => {
  const base = { repo: createFixtureRepository(), now: () => DEMO_NOW, tokens: TOKENS }
  demo = await listen(createHttpApp({ ...base, mode: "demo", env: { MCP_AUTH_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_demo" } }))
  live = await listen(createHttpApp({ ...base, mode: "live", env: {} }))
})

afterAll(async () => {
  await demo.close()
  await live.close()
})

describe("MCP conformance: authorization", () => {
  it("returns 401 with a challenge usable by Alexa-style and RFC 9728 clients", async () => {
    const result = await postRaw(demo.url, initialize(1))
    expect(result.status).toBe(401)
    const challenge = result.headers.get("www-authenticate") ?? ""
    expect(challenge).toMatch(/^Bearer /)
    expect(challenge).toContain('realm="visitproof"')
    expect(challenge).toContain(`resource_metadata="${demo.url}/.well-known/oauth-protected-resource"`)
    expect(challenge).not.toContain("invalid_token")
  })

  it("marks a rejected token as invalid_token", async () => {
    const result = await postRaw(demo.url, initialize(2), { token: "not-a-token" })
    expect(result.status).toBe(401)
    expect(result.headers.get("www-authenticate")).toContain('error="invalid_token"')
  })

  it("serves protected-resource metadata pointing at MCP_AUTH_ISSUER", async () => {
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await fetch(`${demo.url}${path}`)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        resource: `${demo.url}/mcp`,
        authorization_servers: ["https://cognito-idp.us-east-1.amazonaws.com/us-east-1_demo"],
        bearer_methods_supported: ["header"],
      })
    }
  })

  it("accepts demo tokens only in demo mode", async () => {
    expect((await postRaw(demo.url, initialize(3), { token: "agency-demo-token" })).status).toBe(200)
    expect((await postRaw(live.url, initialize(4), { token: "agency-demo-token" })).status).toBe(401)
  })

  it("binds a session to the credential that created it", async () => {
    const session = await openSession(demo.url, "family-demo-token")
    const hijack = await postRaw(demo.url, rpc("tools/list", {}, 5), { sessionId: session.sessionId, token: "agency-demo-token" })
    expect(hijack.status).toBe(403)
  })
})

describe("MCP conformance: scope enforcement", () => {
  it("keeps a family token on its own client", async () => {
    const session = await openSession(demo.url, "family-demo-token")
    const own = await session.call("get_visit_status", {})
    expect((own.structuredContent as { clientId: string }).clientId).toBe("cli_okoro")
    const other = await session.call("get_visit_status", { clientId: "cli_nakamura" })
    expect(other.isError).toBe(true)
    expect(other.content[0]?.text).toContain("only see its own")
    const read = await session.request("resources/read", { uri: "visitproof://schedule/cli_nakamura/2026-09-27" })
    expect(read.error).toBeTruthy()
  })

  it("keeps agency-only tools away from a family token", async () => {
    const session = await openSession(demo.url, "family-demo-token")
    for (const [name, args] of [
      ["list_exceptions", {}],
      ["acknowledge_exception", { exceptionId: "v_alvarez_26#no_show", reason: "test_reason", confirmed: true }],
    ] as const) {
      const result = await session.call(name, args)
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toContain("Only the agency")
    }
  })

  it("lets the agency token use the exception queue", async () => {
    const session = await openSession(demo.url, "agency-demo-token")
    const result = await session.call("list_exceptions", {})
    expect(result.isError).toBeFalsy()
    expect((result.structuredContent as { count: number }).count).toBe(4)
  })
})

describe("MCP conformance: Origin and Host validation (DNS rebinding)", () => {
  it("returns 403 for an invalid Origin", async () => {
    const result = await postRaw(demo.url, initialize(6), { token: "agency-demo-token", headers: { origin: "https://evil.example" } })
    expect(result.status).toBe(403)
    expect((firstMessage(result).error as { message: string }).message).toContain("Origin")
  })

  it("returns 403 for a rebinding Host even with a valid token", async () => {
    expect(await postWithHost(demo.url, "attacker.example:8000", initialize(7), "agency-demo-token")).toBe(403)
    expect(await postWithHost(demo.url, "localhost:8000", initialize(9), "agency-demo-token")).toBe(200)
  })

  it("allows the console origin and requests without an Origin", async () => {
    const ok = await postRaw(demo.url, initialize(8), { token: "agency-demo-token", headers: { origin: "http://localhost:3000" } })
    expect(ok.status).toBe(200)
  })
})

describe("demo token parsing", () => {
  it("parses scoped entries and the two legacy names", () => {
    expect(parseDemoTokens("family-demo-token=family:cli_okoro,agency-demo-token=agency")).toEqual([
      { token: "family-demo-token", scope: "family:cli_okoro" },
      { token: "agency-demo-token", scope: "agency" },
    ])
    expect(parseDemoTokens("family-demo-token,agency-demo-token").map((entry) => entry.scope)).toEqual(["family:cli_okoro", "agency"])
  })

  it("rejects unscoped or malformed entries", () => {
    expect(() => parseDemoTokens("mystery-token")).toThrow("needs a scope")
    expect(() => parseDemoTokens("t=admin")).toThrow("invalid scope")
  })
})
