# AWS Integrations

This page lists every AWS service VisitProof touches, what it does, where the code lives, and its honest status today. Nothing here is deployed yet. The offline demo (`pnpm demo`) runs entirely on the local JSON store and needs no AWS account.

Status values:

- **Running in the demo**: exercised by `pnpm demo` today.
- **Code ready and tested, not deployed**: the adapter and its infrastructure exist, unit tests run against `aws-sdk-client-mock` (no real AWS calls), and `cdk synth` produces the stacks. No `cdk deploy` has been run.
- **Planned**: designed in `docs/build.md` Section 7, not built.

## Service Table

| Service | What it does in VisitProof | File path | Status |
|---|---|---|---|
| Amazon DynamoDB (on-demand, single table) | Door events, visits, exceptions, EVV records, ledger, snapshots, webhook receipts. GSI1 for time-ordered queries, GSI2 for external ids, TTL on `expiresAt`, point-in-time recovery. The document client strips `undefined` fields (`removeUndefinedValues`) and every read is validated with the domain Zod schemas. | `packages/db/src/dynamo-repository.ts`, `packages/db/src/dynamo/table-client.ts`, `infra/lib/data-stack.ts` | Code ready and tested, not deployed |
| DynamoDB Streams | Triggers the Presence Engine for each new door event (INSERT, `sk` begins with `EVENT#`). Failed records are returned as batch item failures and retried; poison records go to an SQS DLQ. | `apps/engine/src/handlers/event-processor.ts`, `apps/engine/src/lambda/event-processor.ts`, `infra/lib/engine-stack.ts` | Code ready and tested, not deployed |
| AWS Lambda (Node 22, arm64) | Webhook receiver (5 s timeout, 256 MB), event processor, visit sweeper, daily digest. Bundled at synth time with the esbuild JS API. | `apps/webhooks/src/lambda.ts`, `apps/engine/src/lambda/*.ts`, `infra/lib/lambda.ts` | Code ready and tested, not deployed |
| Amazon API Gateway (HTTP API) | Public Ring Webhook URL: `POST /ring/webhook`, stage throttling at 50 requests per second (burst 100). | `infra/lib/webhook-stack.ts` | Code ready and tested, not deployed |
| Amazon EventBridge (scheduled rules) | Runs the visit sweeper every minute and the daily digest at 23:00 UTC (7 PM Eastern daylight time). | `infra/lib/engine-stack.ts` | Code ready and tested, not deployed |
| Amazon S3 | Media bucket: Ring snapshots under `snapshots/` (tagged with the family's retention class and expired by lifecycle rules at 1, 7, 14, or 30 days, with a 30 day safety net), evidence packs under `evidence/` and `evv/`. SSE-KMS, all public access blocked, TLS only. | `apps/engine/src/adapters/ring-snapshot-service.ts`, `apps/engine/src/adapters/s3-evidence-store.ts`, `infra/lib/data-stack.ts` | Code ready and tested, not deployed |
| AWS KMS (ledger signing) | Asymmetric ECC_NIST_P256 SIGN_VERIFY key. `KmsLedgerSigner` signs the 32 byte ledger signing digest with ECDSA_SHA_256 and verifies with KMS Verify. Demo mode uses a local HMAC stand-in (`createLocalHmacLedgerSigner`, kind `local-hmac`, the same format the console and MCP demo signers use), which live mode refuses. The event processor and the visit sweeper append ledger records as they decide (`repositoryLedger` in `apps/engine/src/lib/ledger.ts`, wired by `createAwsDeps`), so those two functions are granted `kms:Sign` on this key and nothing else is. | `apps/engine/src/adapters/ledger-signers.ts`, `apps/engine/src/lib/ledger.ts`, `infra/lib/data-stack.ts`, `infra/lib/engine-stack.ts` | Code ready and tested, not deployed (the local HMAC stand-in runs in the demo) |
| AWS KMS (token encryption) | Symmetric key with rotation for Ring OAuth tokens. The key is defined; no code encrypts tokens with it yet. | `infra/lib/data-stack.ts` | Planned |
| Amazon Bedrock (Converse, Nova 2 Lite) | Rewrites the deterministic template narrative in plain language. Only statuses and times are sent (no names, no ids). Every answer passes the domain narrative validator or the template is used, with provenance `template`. Model id from `BEDROCK_MODEL_ID` (default `global.amazon.nova-2-lite-v1:0`). | `apps/engine/src/adapters/bedrock-narrator.ts` | Code ready and tested, not deployed |
| Amazon Bedrock Guardrails | Applied to each Converse call when `BEDROCK_GUARDRAIL_ID` and `BEDROCK_GUARDRAIL_VERSION` are set; an intervention falls back to the template. The guardrail itself is not created by the CDK app. | `apps/engine/src/adapters/bedrock-narrator.ts` | Code ready and tested, not deployed |
| Amazon Bedrock via Strands Agents | Ask VisitProof agent that answers questions using the VisitProof MCP server, when `MODEL_PROVIDER=bedrock`. The demo default is the fixture brain. | `apps/copilot/src/ask/strands-brain.ts` | Code ready and tested, not deployed |
| Amazon SES | Daily family digest and exception alerts, times in the agency time zone. Sandbox safe: every message is sent from the one verified sender, and an optional recipient allowlist skips unverified addresses. | `apps/engine/src/adapters/ses-mailer.ts`, `apps/engine/src/handlers/mailer.ts`, `apps/engine/src/lambda/daily-digest.ts` | Code ready and tested, not deployed |
| Amazon SQS | Dead letter queues for the webhook Lambda (asynchronous invocations) and for stream records that exhaust their retries. | `infra/lib/webhook-stack.ts`, `infra/lib/engine-stack.ts` | Code ready and tested, not deployed |
| Amazon CloudWatch | Two week log retention for every function; alarms on webhook 5xx responses and webhook Lambda errors. | `infra/lib/lambda.ts`, `infra/lib/webhook-stack.ts` | Code ready and tested, not deployed |
| Amazon SNS | Alerts topic for budget notifications and alarms, with an optional email subscription (`-c alertEmail=...`). | `infra/lib/observability-stack.ts` | Code ready and tested, not deployed |
| AWS Budgets | Monthly cost budget of 100 USD with alerts at 50 percent (50 USD) and 100 percent (100 USD). | `infra/lib/observability-stack.ts` | Code ready and tested, not deployed |
| Amazon Rekognition | `DetectLabels` on the watermark-cropped snapshot copy. The dependency is declared; no code calls it, and stored snapshots carry empty `labels`. | `apps/engine/package.json` | Planned |
| Amazon Cognito | Passwordless sign in and the OAuth issuer for the MCP server (AuthStack). | none yet | Planned |
| Amazon Bedrock AgentCore Runtime | Hosting the MCP server as a JWT-protected endpoint (McpStack). | none yet | Planned |
| AWS Amplify Hosting | Hosting the Next.js console (HostingStack). | none yet | Planned |

Every resource the CDK app creates is tagged `Project=visitproof` (`infra/lib/stacks.ts`).

## Runtime Switches

`createAwsDeps(env)` in `apps/engine/src/aws-deps.ts` is the single place that decides which adapters are active. With no AWS variables the engine runs fully offline.

| Adapter | Active when | Otherwise |
|---|---|---|
| Store | `VISITPROOF_STORE=dynamodb` | Local JSON store |
| Narrator | `MODEL_PROVIDER=bedrock` | Deterministic template |
| Ledger signer | `KMS_SIGNING_KEY_ID` is set | Local HMAC stand-in (refused when `VISITPROOF_MODE=live`) |
| Mail | `SES_FROM_ADDRESS` is set | Console fixture (logs only) |
| Snapshots | `S3_SNAPSHOT_BUCKET` and `RING_PLAYGROUND_ACCESS_TOKEN` are set | Disabled |
| Evidence store | `S3_SNAPSHOT_BUCKET` is set | In memory |

The deployed EngineStack does not pass a Ring token, so snapshot fetching stays disabled in AWS until a KMS-encrypted token store exists. The adapter itself is tested end to end against a mocked Ring 303 flow, including 416 (no media, final), 425 (recording not ready, retried on the next sweep), 403, and encrypted frames (never stored).

## Architecture

```
Ring cloud
  | POST signed webhook (5 s budget, at least once)
  v
API Gateway HTTP API  POST /ring/webhook  (throttled 50 rps)
  v
Lambda: webhook receiver (apps/webhooks)
  - verifies the HMAC signature, claims the request id, stores the door event
  - acknowledges 202; VISITPROOF_ENGINE_INLINE=false, so no engine work here
  v
DynamoDB table "visitproof"  (pk/sk, GSI1, GSI2, TTL, PITR)
  | stream: INSERT of EVENT# items only
  v
Lambda: event processor (apps/engine)
  - Presence Engine with the agency's tolerances
  - batch item failures -> retry; exhausted -> SQS DLQ

EventBridge every minute -> Lambda: visit sweeper
  - late, no show, departure quiet periods, unobservable overlay
  - snapshot fetch (Ring 303 -> S3 with retention tag) when a token source exists
  - narratives: Bedrock Converse (Nova 2 Lite, optional Guardrails) or template

EventBridge daily 23:00 UTC -> Lambda: daily digest -> SES (verified sender)

KMS: ECDSA P-256 ledger signing key, symmetric token key
S3: media bucket (SSE-KMS, lifecycle by retention tag)
CloudWatch alarms and AWS Budgets -> SNS alerts topic -> email
```

## How To Deploy

Deployment is manual and has not been run. Use short-lived credentials from **IAM Identity Center** (preferred) or a **least-privilege IAM user**. **Never use root access keys.** If the account root user has access keys, delete them in the IAM console (Security credentials) before you start.

1. Create credentials.
   - IAM Identity Center: create a user, and two permission sets. `VisitProofBootstrap` (AdministratorAccess, 1 hour sessions) is used once for `cdk bootstrap`. `VisitProofDeploy` holds only the policy below. Run `aws configure sso` and name the profiles `visitproof-bootstrap` and `visitproof-deploy`.
   - Or an IAM user with the policy below and MFA, used only for deploys.
2. Deploy policy. After bootstrap, the CDK CLI does everything through the bootstrap roles, so the deploying identity only needs to assume them:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": "sts:AssumeRole",
         "Resource": "arn:aws:iam::ACCOUNT_ID:role/cdk-hnb659fds-*"
       }
     ]
   }
   ```

3. Verify the SES sender (and, in the SES sandbox, every recipient) in the SES console.
4. Bootstrap once: `pnpm --filter infra exec cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile visitproof-bootstrap`
5. Synthesize and review: `pnpm --filter infra exec cdk synth --no-lookups`
6. Deploy:

   ```
   pnpm --filter infra exec cdk deploy --all --profile visitproof-deploy \
     -c alertEmail=you@example.com \
     -c sesFromAddress=alerts@example.com \
     --parameters VisitProof-dev-Webhook:RingHmacSigningKey=YOUR_RING_SIGNING_KEY
   ```

   Optional context: `environment`, `region`, `agencyId`, `modelProvider` (`bedrock` or `fixture`), `bedrockModelId`, `bedrockGuardrailId` with `bedrockGuardrailVersion`, `sesAllowedRecipients`, `budgetLimitUsd`.
7. Paste the `RingWebhookUrl` stack output into the Ring Developer Portal.
8. Tear down between sessions: `pnpm --filter infra exec cdk destroy VisitProof-dev-Engine VisitProof-dev-Webhook --profile visitproof-deploy`. The table (deletion protection on), the bucket, and the KMS keys are retained by design.

Known limits of this first version:

- The webhook signing key is a NoEcho CloudFormation parameter that lands in the Lambda environment. Moving it to SSM Parameter Store (SecureString) needs a change in `apps/webhooks`.
- The webhook DLQ only receives failed asynchronous invocations; API Gateway invokes synchronously, so receiver failures surface through the 5xx alarm.
- The digest runs at one fixed UTC hour, not at each family's `digestHour`.

## Cost Estimate

Monthly, for the demo agency (a handful of clients, a few visits a day), with the stacks above deployed all month. These are estimates from public on-demand prices, not observed bills.

| Item | Estimate |
|---|---|
| KMS: two customer managed keys at 1 USD each, plus requests | about 2 USD |
| Lambda: sweeper 43,200 runs of about 1 s at 256 MB, plus the other functions | inside the free tier, otherwise under 1 USD |
| DynamoDB on-demand, streams, PITR on a few MB | under 1 USD |
| API Gateway HTTP API | under 0.10 USD |
| S3 (small snapshots, 7 day default retention) | under 0.10 USD |
| Bedrock Nova 2 Lite (about 400 tokens per narrative, a few per day) | under 0.10 USD |
| SES (0.10 USD per 1,000 messages) | under 0.10 USD |
| CloudWatch (two alarms, two week logs) | about 0.50 USD |
| SQS, SNS, EventBridge schedules, AWS Budgets (first two budgets free) | about 0 USD |
| **Total** | **about 3 to 5 USD per month** |

The budget alarms at 50 USD and 100 USD sit far above this, so they catch mistakes (a runaway loop, a forgotten large resource) rather than normal use.

## How Kiro Was Used

Kiro steering, specs, hooks, and MCP settings are committed under `.kiro/`:

- `.kiro/steering/product.md`, `tech.md`, `structure.md`, and `ui-rules.md` carry the product rules, stack, layout, and design system rules.
- `.kiro/specs/presence-engine/requirements.md` states the Presence Engine rules in EARS form. The engine handlers in `apps/engine` apply rule 4 (late and no show escalation) with the agency's own tolerances, `KmsLedgerSigner` is the signing path for rule 10, and `apps/engine/test` covers both.
- `.kiro/hooks/copy-rules.json` re-reads the requirements before each task and runs the copy rules check on message files.
- `.kiro/settings/mcp.json` connects the shadcn MCP server and the Ring Appstore knowledge MCP server.

Not done yet: Kiro Crew job exports and `LESSONS.md` under `docs/kiro-crew/`, and the `design.md` and `tasks.md` files for the presence-engine spec.
