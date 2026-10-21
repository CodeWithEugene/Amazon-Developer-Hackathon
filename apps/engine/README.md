# @visitproof/engine

Lambda handlers for the Presence Engine runtime, and the adapters that connect them to AWS. Domain logic stays in `@visitproof/domain`.

Handlers (`src/handlers/`): `event-processor` (DynamoDB Streams, returns batch item failures), `visit-sweeper` (every minute, per-agency tolerances), `narrative-writer`, `snapshot-fetcher`, `exporter`, `mailer` (exception alerts and the daily digest, agency time zone).

Lambda entries (`src/lambda/`): `event-processor.ts`, `visit-sweeper.ts` (sweep, snapshot fetch, narratives), `daily-digest.ts`. The CDK app in `infra/` bundles these.

Adapters (`src/adapters/`), each behind an env switch chosen by `createAwsDeps(env)` in `src/aws-deps.ts`:

| Adapter                                                              | File                       | Active when                                                 |
| -------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------- |
| Bedrock narrator (Converse, optional Guardrails, template fallback)  | `bedrock-narrator.ts`      | `MODEL_PROVIDER=bedrock`                                    |
| KMS ledger signer (ECDSA_SHA_256), local HMAC stand-in for demo mode | `ledger-signers.ts`        | `KMS_SIGNING_KEY_ID` set                                    |
| SES mail transport (verified sender, optional sandbox allowlist)     | `ses-mailer.ts`            | `SES_FROM_ADDRESS` set                                      |
| Ring snapshot to S3 plus Snapshot entity                             | `ring-snapshot-service.ts` | `S3_SNAPSHOT_BUCKET` and `RING_PLAYGROUND_ACCESS_TOKEN` set |
| S3 evidence store                                                    | `s3-evidence-store.ts`     | `S3_SNAPSHOT_BUCKET` set                                    |

Tests use `aws-sdk-client-mock` and a mocked Ring `fetch`; nothing calls AWS or Ring. Scripts: `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.
