import { describe, expect, it } from "vitest"

import { buildContentSecurityPolicy, cspDirectives, cspProblems } from "./csp"

const directive = (policy: string, name: string): string[] | undefined =>
  policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([candidate]) => candidate === name)
    ?.slice(1)

describe("console Content-Security-Policy", () => {
  for (const dev of [false, true]) {
    describe(dev ? "development" : "production", () => {
      const policy = buildContentSecurityPolicy({ dev })

      it("never combines 'none' with other sources in any directive", () => {
        for (const sources of Object.values(cspDirectives({ dev }))) {
          if (sources.includes("'none'")) expect(sources).toEqual(["'none'"])
        }
        expect(cspProblems(policy)).toEqual([])
      })

      it("keeps default-src to the console's own origin", () => {
        expect(directive(policy, "default-src")).toEqual(["'self'"])
      })

      it("allows the live view's video sources and same-origin WHEP signaling", () => {
        expect(directive(policy, "media-src")).toEqual(["'self'", "blob:", "mediastream:"])
        expect(directive(policy, "connect-src")).toEqual(["'self'"])
      })

      it("blocks plugins and framing", () => {
        expect(directive(policy, "object-src")).toEqual(["'none'"])
        expect(directive(policy, "frame-ancestors")).toEqual(["'none'"])
      })
    })
  }

  it("allows 'unsafe-eval' only in development", () => {
    expect(directive(buildContentSecurityPolicy({ dev: false }), "script-src")).not.toContain("'unsafe-eval'")
    expect(directive(buildContentSecurityPolicy({ dev: true }), "script-src")).toContain("'unsafe-eval'")
  })

  it("is a single header line", () => {
    expect(buildContentSecurityPolicy({ dev: false })).not.toMatch(/[\r\n]/)
  })
})

describe("cspProblems", () => {
  it("flags 'none' alongside other sources", () => {
    expect(cspProblems("default-src 'none' 'self'; img-src 'self'")).toEqual([
      "default-src combines 'none' with other sources",
    ])
  })

  it("flags duplicate and empty directives", () => {
    expect(cspProblems("script-src 'self'; script-src 'none'; font-src")).toEqual([
      "script-src is declared more than once",
      "font-src has no sources",
    ])
  })

  it("accepts standalone directives", () => {
    expect(cspProblems("default-src 'self'; upgrade-insecure-requests")).toEqual([])
  })
})
