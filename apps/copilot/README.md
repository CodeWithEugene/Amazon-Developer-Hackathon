# @visitproof/copilot

Strands agent (`@strands-agents/sdk`) that powers the agency ops copilot and the Ask VisitProof simulator. It talks to the MCP server over Streamable HTTP; with `MODEL_PROVIDER=fixture` it replays golden utterance mappings from `apps/mcp/test/golden.json` without calling a model.
