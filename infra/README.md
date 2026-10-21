# @visitproof/infra

AWS CDK v2 (TypeScript) app for the stacks VisitProof can use today (see `docs/aws-integrations.md` for status and cost):

- `VisitProof-<env>-Data` (`lib/data-stack.ts`): DynamoDB single table (GSI1, GSI2, TTL, streams, PITR), S3 media bucket (SSE-KMS, public access blocked, lifecycle by retention tag), KMS token key and ECDSA P-256 ledger signing key.
- `VisitProof-<env>-Observability` (`lib/observability-stack.ts`): SNS alerts topic and an AWS Budgets monthly budget with alerts at 50 and 100 USD.
- `VisitProof-<env>-Webhook` (`lib/webhook-stack.ts`): HTTP API `POST /ring/webhook` to the `apps/webhooks` Lambda (arm64, 256 MB, 5 s), DLQ, 5xx and error alarms.
- `VisitProof-<env>-Engine` (`lib/engine-stack.ts`): stream event processor (batch item failures), visit sweeper every minute, daily digest over SES, least-privilege IAM.

Auth, MCP (AgentCore), and Hosting stacks from `docs/build.md` Section 7 are planned.

Lambda code is bundled during synth with the esbuild JS API (`lib/lambda.ts`); no Docker is needed.

## Commands

- `pnpm --filter infra test`: assertion tests (bundling skipped).
- `pnpm --filter infra exec cdk synth --no-lookups`: synthesizes offline. The stacks need no account id and no context lookups. The CDK CLI still tries to discover a default account from any credentials in your shell, so for a fully offline synth run it with credentials unset (for example `AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_CONFIG_FILE=/dev/null`).
- Deploying is manual and uses IAM Identity Center or a least-privilege IAM user, never root access keys. Follow `docs/aws-integrations.md`, "How To Deploy".
