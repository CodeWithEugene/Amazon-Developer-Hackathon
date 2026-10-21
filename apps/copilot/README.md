# @visitproof/copilot

The brain behind Ask VisitProof (`/ask` in the console) and the agency ops copilot.

## Ask VisitProof brains

`askVisitProof({ utterance, persona, token, pending }, { config })` answers one turn by calling the VisitProof MCP server over Streamable HTTP and returns the spoken answer, every tool call with its structured content, a timing trace, and which brain answered.

| `MODEL_PROVIDER` | Brain | How it reaches MCP |
|---|---|---|
| `fixture` (default) | Deterministic rules (`src/ask/fixture-brain.ts`) map the utterance to MCP tool calls | `@modelcontextprotocol/sdk` `Client` with `StreamableHTTPClientTransport` |
| `bedrock` | A Strands agent (`@strands-agents/sdk`) with `BedrockModel` (`BEDROCK_MODEL_ID`, default `global.amazon.nova-2-lite-v1:0`, region `AWS_REGION`) | Strands `McpClient` over Streamable HTTP, the MCP server as its only tool source |

If Bedrock fails (for example no credentials), the fixture brain answers and the turn says `Bedrock unavailable: <reason>`. The Strands module is loaded only in `bedrock` mode (`@visitproof/copilot/strands`).

Writes follow the server's confirmation flow: the first call returns `confirmation_required`, the turn carries `pendingConfirmation`, and a following "yes" replays it with `confirmed: true` ("no" sends `confirmed: false`).

Configuration: `askConfigFromEnv(process.env)` reads `MODEL_PROVIDER`, `MCP_URL` (default `http://localhost:8000/mcp`), `BEDROCK_MODEL_ID`, `AWS_REGION`, and `VISITPROOF_TIME_ZONE` (default `America/New_York`). `demoTokenFor(persona, MCP_DEMO_TOKENS)` picks the demo bearer token whose scope matches the persona.

## Ops copilot (accessor based)

`createOpsCopilot({ accessor, now, env })` answers late arrivals, no-shows, missing evidence, and exception explanations from a `CopilotDataAccessor` (`createDbCopilotAccessor(store, agencyId)` adapts `@visitproof/db`). Lateness comes from the door arrival (scheduled start plus the grace window), not the terminal status. Answers name at most five items with client first names and agency-local times; every row stays in `data`, and `query` records what ran.

## Tests

`pnpm --filter @visitproof/copilot test` runs, with no AWS or network calls:

- `test/golden.test.ts`: every golden utterance in `apps/mcp/test/golden.json` through the fixture brain against a real VisitProof MCP server on an ephemeral port, checking the tool calls, arguments, and spoken answer.
- `test/ask.test.ts`: confirmation flow, persona scoping, trace, an unreachable server, the Strands agent with a scripted model (`test/scripted-model.ts`) standing in for Bedrock, and the fallback when Bedrock fails.
- `test/db-accessor.test.ts`: the ops copilot over a temp-directory local store seeded in the demo shape.
- `src/copilot.test.ts`: intent parsing and the ops copilot tools.
