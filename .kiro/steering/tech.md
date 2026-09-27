---
inclusion: always
---
# VisitProof Tech Steering

- pnpm only; Turborepo monorepo; Node 22 target (Node 26 locally).
- Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, shadcn/ui with Base UI primitives (style base-nova).
- Zod at every boundary; immutable data; files under 500 lines; functions under 50 lines; tests first for packages/domain (coverage over 80%).
- AWS: Lambda, DynamoDB single table, S3, KMS, SES, Cognito, Amplify Hosting, Bedrock Nova 2 Lite with Guardrails, Rekognition, AgentCore Runtime, Strands Agents.
- MCP server on @modelcontextprotocol/sdk 1.x implementing spec 2025-11-25 over Streamable HTTP with version negotiation for 2025-03-26.
- Ring Partner API via packages/ring-partner-sdk; webhook signatures verified over raw bytes; dedupe on meta.request_id; tokens encrypted with KMS; no browser calls to Ring.
- Demo mode by default: emulator plus JsonFileStore; live mode opt-in per subsystem.
- Never commit secrets; .env is git-ignored; .env.example is the only env file in git.
