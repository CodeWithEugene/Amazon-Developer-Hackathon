# @visitproof/db

DynamoDB single-table access layer (table `visitproof`, keys `pk` and `sk`, `gsi1` for time-ordered queries, `gsi2` for lookups by external id, TTL attribute `expiresAt`).

Entities and key shapes are defined in `docs/build.md` Section 4; entity schemas come from `@visitproof/domain`. This package owns key builders, marshalling, and repositories, and is tested with `aws-sdk-client-mock`.

## Access patterns

To be enumerated here, one row per screen, with the exact query (see build.md Section 4).

Scripts: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
