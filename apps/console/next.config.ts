import type { NextConfig } from "next"

import { buildContentSecurityPolicy } from "./lib/security/csp"

const contentSecurityPolicy = buildContentSecurityPolicy({ dev: process.env.NODE_ENV === "development" })

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The hosted demo (VISITPROOF_HOSTED_DEMO=1) reads the shipped seed store at runtime.
  outputFileTracingIncludes: { "/**": ["./demo-seed/**"] },
  transpilePackages: [
    "@workspace/ui",
    "@visitproof/config",
    "@visitproof/db",
    "@visitproof/domain",
    "@visitproof/ring-partner-sdk",
    "@visitproof/copilot",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
      },
    ]
  },
}

export default nextConfig
