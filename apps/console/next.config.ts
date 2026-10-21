import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: [
    "@workspace/ui",
    "@visitproof/config",
    "@visitproof/db",
    "@visitproof/domain",
    "@visitproof/ring-partner-sdk",
    "@visitproof/copilot",
  ],
}

export default nextConfig
