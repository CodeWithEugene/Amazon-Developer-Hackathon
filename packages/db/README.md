# @visitproof/db

DynamoDB single-table access layer (table `visitproof`, keys `pk` and `sk`, `gsi1` for time-ordered queries, `gsi2` for lookups by external id, TTL attribute `expiresAt`).

Entities and key shapes are defined in `docs/build.md` Section 4; entity schemas come from `@visitproof/domain`. This package owns key builders, marshalling, and repositories.

## Repositories

- `createDynamoRepository` (production): document client built by `createDocumentClient` with `removeUndefinedValues`, conditional puts for door events, the ledger, and webhook receipts, and Zod validation of every item read (`validate: false` turns it off). Tested with `aws-sdk-client-mock` plus one test that runs the SDK's real marshalling offline.
- `createLocalRepository` (demo and tests): one JSON file per table. Safe for several processes sharing the directory (console, webhooks, MCP, demo script): each read re-parses the file when it changed on disk, each write goes to a temp file and is renamed into place, and each read-modify-write holds a cross-process lockfile (`<table>.json.lock`, retry with backoff, stale lock recovery). `test/local-concurrency.test.ts` runs two processes against one store and checks that no write is lost.

Optional sections (both repositories implement them): `agencies` (the local repository falls back to the demo `agency.json`), `events.deleteByClient`, and `evidence.deleteByVisit` for "Delete Everything".

`table.ts` is pure data consumed by `infra/` (table definition, snapshot retention classes).

Scripts: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
