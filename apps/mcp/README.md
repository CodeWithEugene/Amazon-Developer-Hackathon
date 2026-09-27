# @visitproof/mcp

MCP server for Ask VisitProof and Alexa+: Express with `@modelcontextprotocol/sdk` 1.x (Streamable HTTP, protocol versions 2025-03-26 and 2025-11-25). Listens on `0.0.0.0:8000/mcp` as AgentCore Runtime expects; stateful sessions locally, stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`) on serverless.

- `src/index.ts` `createMcpServer()` and `createHttpApp()`.
- `src/server.ts` entry point (`pnpm dev`, `pnpm build`).
- `test/conformance/` transport, auth, tools, structured output, golden utterances (`pnpm mcp:conformance` from the root).

Tools, resources, and prompt are specified in `docs/build.md` Section 8.
