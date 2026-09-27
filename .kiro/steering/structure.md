---
inclusion: always
---
# VisitProof Repository Structure

apps/console (Next.js: agency console, family portal, caregiver record, Ring endpoints, Ask simulator, Demo Studio), apps/webhooks (Ring webhook receiver, Lambda and local), apps/engine (event processor, visit sweeper, narratives, snapshots, mailer, exporter), apps/mcp (MCP server), apps/copilot (Strands agent), packages/ring-partner-sdk (published SDK and emulator), packages/domain (Presence Engine, reconciliation, ledger, EVV export, judgments, narratives), packages/db (DynamoDB single table, repositories, ciphers, seed), packages/ui (shadcn components and theme), packages/config (shared configs), infra (CDK), docs (specs, research, friction log, compliance), .kiro (this directory).

Only modify the directory a task assigns. Domain code has no AWS imports. UI primitives come from packages/ui via the CLI only.
