# @visitproof/infra

AWS CDK v2 (TypeScript) app for the four stacks VisitProof uses today. Status, verification evidence, and cost are in `docs/aws-integrations.md`.

| Stack                            | Source                       | What it creates                                                                                                                                                                                                                                                                                |
| -------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VisitProof-<env>-Data`          | `lib/data-stack.ts`          | DynamoDB single table `visitproof` (GSI1, GSI2, TTL, streams, PITR, deletion protection), S3 media bucket (SSE-KMS, public access blocked, lifecycle by retention tag), KMS token key (`alias/visitproof-ring-tokens`) and ECDSA P-256 ledger signing key (`alias/visitproof-ledger-signing`). |
| `VisitProof-<env>-Observability` | `lib/observability-stack.ts` | SNS alerts topic and the AWS Budgets monthly budget `visitproof-monthly` (100 USD, alerts at 50 and 100 percent).                                                                                                                                                                              |
| `VisitProof-<env>-Webhook`       | `lib/webhook-stack.ts`       | HTTP API `POST /ring/webhook` to the `apps/webhooks` Lambda (arm64, 256 MB, 5 s), DLQ, 5xx and error alarms. Output: `RingWebhookUrl`.                                                                                                                                                         |
| `VisitProof-<env>-Engine`        | `lib/engine-stack.ts`        | Stream event processor (batch item failures, DLQ), visit sweeper every minute, daily digest at 23:00 UTC, least-privilege IAM.                                                                                                                                                                 |

The default environment name is `dev` (`lib/config.ts`). Auth (Cognito), MCP (Bedrock AgentCore Runtime), and Hosting (Amplify) stacks from `docs/build.md` Section 7 are planned and not built.

Lambda code is bundled during synth with the esbuild JS API (`lib/lambda.ts`); no Docker is needed.

## Deployed Now

On 22 October 2026 all four stacks were deployed for env `dev` to `us-east-1` (plus the `CDKToolkit` bootstrap stack), and the webhook to stream to engine to KMS ledger path was verified end to end with a synthetic signed webhook. Not configured in that deployment: no alert email subscription, no SES sender (the digest does not mail), the webhook URL is not registered with Ring, and Bedrock Nova 2 Lite calls are throttled because the account's quotas are 0, so narratives fall back to the template. The console still runs locally. Details: `docs/aws-integrations.md`, "What Is Deployed Now".

## Commands

- `pnpm --filter infra test`: assertion tests (bundling skipped).
- `pnpm --filter infra typecheck` and `pnpm --filter infra lint`: run before any deploy.
- `pnpm --filter infra exec cdk synth --no-lookups`: synthesizes offline. The stacks need no account id and no context lookups. The CDK CLI still tries to discover a default account from any credentials in your shell, so for a fully offline synth run it with credentials unset (for example `AWS_SHARED_CREDENTIALS_FILE=/dev/null AWS_CONFIG_FILE=/dev/null`).
- Deploy and tear down: follow `docs/aws-integrations.md`, "How To Deploy" and "How To Tear Down". Use short-lived credentials (`aws login` or IAM Identity Center), never long-lived access keys.

## Tear Down In Short

```
pnpm --filter infra exec cdk destroy VisitProof-dev-Engine VisitProof-dev-Webhook VisitProof-dev-Observability VisitProof-dev-Data
```

The table, the media bucket, both KMS keys, and the Lambda log groups are retained by design and must be deleted by hand. The steps are in `docs/aws-integrations.md`, "How To Tear Down".
