# AWS Integrations

This page lists every AWS service VisitProof touches, what it does, where the code lives, and its honest status today.

As of 22 October 2026, four CDK stacks are deployed to one AWS account in `us-east-1` for the environment `dev`, and the event path (signed webhook, DynamoDB, stream, Presence Engine, KMS-signed ledger) was verified end to end with a synthetic signed webhook. The Auth, MCP on AgentCore, and Hosting stacks are not built. The console (`apps/console`) still runs locally against the local JSON store, and the offline demo (`pnpm demo`) needs no AWS account.

Status values:

- **Deployed and verified**: running in AWS and exercised by the 22 October 2026 end to end check.
- **Deployed, not exercised**: running in AWS, but nothing in the check reached it yet.
- **Deployed, blocked**: running in AWS, but an account limit or missing setting stops it from doing its job.
- **Code ready and tested, not deployed**: the adapter exists and unit tests run against `aws-sdk-client-mock` (no real AWS calls), but no stack runs it.
- **Planned**: designed in `docs/build.md` Section 7, not built.

## Service Table

| Service | What it does in VisitProof | File path | Status |
|---|---|---|---|
| Amazon DynamoDB (on-demand, single table) | Door events, visits, exceptions, EVV records, ledger, snapshots, webhook receipts. GSI1 for time-ordered queries, GSI2 for external ids, TTL on `expiresAt`, point-in-time recovery, deletion protection. The document client strips `undefined` fields (`removeUndefinedValues`) and every read is validated with the domain Zod schemas. | `packages/db/src/dynamo-repository.ts`, `packages/db/src/dynamo/table-client.ts`, `infra/lib/data-stack.ts` | Deployed and verified (table `visitproof`) |
| DynamoDB Streams | Triggers the Presence Engine for each new door event (INSERT, `sk` begins with `EVENT#`). Failed records are returned as batch item failures and retried; poison records go to an SQS DLQ. | `apps/engine/src/handlers/event-processor.ts`, `apps/engine/src/lambda/event-processor.ts`, `infra/lib/engine-stack.ts` | Deployed and verified |
| AWS Lambda (Node 22, arm64) | Webhook receiver (5 s timeout, 256 MB), event processor, visit sweeper, daily digest. Bundled at synth time with the esbuild JS API. | `apps/webhooks/src/lambda.ts`, `apps/engine/src/lambda/*.ts`, `infra/lib/lambda.ts` | Deployed and verified (receiver, processor, sweeper); the daily digest is deployed and had not run yet at check time |
| Amazon API Gateway (HTTP API) | Public Ring Webhook URL: `POST /ring/webhook`, stage throttling at 50 requests per second (burst 100). | `infra/lib/webhook-stack.ts` | Deployed and verified; the URL is not registered with Ring yet |
| Amazon EventBridge (scheduled rules) | Runs the visit sweeper every minute and the daily digest at 23:00 UTC (7 PM Eastern daylight time). | `infra/lib/engine-stack.ts` | Deployed and verified (sweeper runs every minute) |
| Amazon S3 | Media bucket: Ring snapshots under `snapshots/` (tagged with the family's retention class and expired by lifecycle rules at 1, 7, 14, or 30 days, with a 30 day safety net), evidence packs under `evidence/` and `evv/`. SSE-KMS, all public access blocked, TLS only. | `apps/engine/src/adapters/ring-snapshot-service.ts`, `apps/engine/src/adapters/s3-evidence-store.ts`, `infra/lib/data-stack.ts` | Deployed, not exercised (no Ring token is passed to AWS, so no snapshots) |
| AWS KMS (ledger signing) | Asymmetric ECC_NIST_P256 SIGN_VERIFY key. `KmsLedgerSigner` signs the 32 byte ledger signing digest with ECDSA_SHA_256 and verifies with KMS Verify. Demo mode uses a local HMAC stand-in (`createLocalHmacLedgerSigner`, kind `local-hmac`, the same format the console and MCP demo signers use), which live mode refuses. The event processor and the visit sweeper append ledger records as they decide (`repositoryLedger` in `apps/engine/src/lib/ledger.ts`, wired by `createAwsDeps`), so those two functions are granted `kms:Sign` on this key and nothing else is. | `apps/engine/src/adapters/ledger-signers.ts`, `apps/engine/src/lib/ledger.ts`, `infra/lib/data-stack.ts`, `infra/lib/engine-stack.ts` | Deployed and verified (a KMS-signed ledger record was written) |
| AWS KMS (token encryption) | Symmetric key with rotation for Ring OAuth tokens. The key exists; no code encrypts tokens with it yet. | `infra/lib/data-stack.ts` | Deployed, not used by code yet |
| Amazon Bedrock (Converse, Nova 2 Lite) | Rewrites the deterministic template narrative in plain language. Only statuses and times are sent (no names, no ids). Every answer passes the domain narrative validator or the template is used, with provenance `template`. Model id from `BEDROCK_MODEL_ID` (default `global.amazon.nova-2-lite-v1:0`). | `apps/engine/src/adapters/bedrock-narrator.ts` | Deployed, blocked: every Nova 2 Lite on-demand quota in the account is 0, so Converse returns `ThrottlingException` and the narrator falls back to the template |
| Amazon Bedrock Guardrails | Applied to each Converse call when `BEDROCK_GUARDRAIL_ID` and `BEDROCK_GUARDRAIL_VERSION` are set; an intervention falls back to the template. The guardrail itself is not created by the CDK app. | `apps/engine/src/adapters/bedrock-narrator.ts` | Code ready and tested, not deployed (no guardrail configured) |
| Amazon Bedrock via Strands Agents | Ask VisitProof agent that answers questions using the VisitProof MCP server, when `MODEL_PROVIDER=bedrock`. The demo default is the fixture brain. | `apps/copilot/src/ask/strands-brain.ts` | Code ready and tested, not deployed |
| Amazon SES | Daily family digest and exception alerts, times in the agency time zone. Sandbox safe: every message is sent from the one verified sender, and an optional recipient allowlist skips unverified addresses. | `apps/engine/src/adapters/ses-mailer.ts`, `apps/engine/src/handlers/mailer.ts`, `apps/engine/src/lambda/daily-digest.ts` | Code ready and tested, not deployed (no SES identity; the digest Lambda has no send permission and does not mail) |
| Amazon SQS | Dead letter queues for the webhook Lambda (asynchronous invocations) and for stream records that exhaust their retries. | `infra/lib/webhook-stack.ts`, `infra/lib/engine-stack.ts` | Deployed (both queues held 0 messages after the check) |
| Amazon CloudWatch | Two week log retention for every function; alarms on webhook 5xx responses and webhook Lambda errors. | `infra/lib/lambda.ts`, `infra/lib/webhook-stack.ts` | Deployed and verified (both alarms in state OK) |
| Amazon SNS | Alerts topic for budget notifications and alarms, with an optional email subscription (`-c alertEmail=...`). | `infra/lib/observability-stack.ts` | Deployed, no subscribers (no one is notified yet) |
| AWS Budgets | Monthly cost budget of 100 USD with alerts at 50 percent (50 USD) and 100 percent (100 USD). | `infra/lib/observability-stack.ts` | Deployed (`visitproof-monthly`, alerts go to the SNS topic) |
| Amazon Rekognition | `DetectLabels` on the watermark-cropped snapshot copy. The dependency is declared; no code calls it, and stored snapshots carry empty `labels`. | `apps/engine/package.json` | Planned |
| Amazon Cognito | Passwordless sign in and the OAuth issuer for the MCP server (AuthStack). | none yet | Planned, not deployed |
| Amazon Bedrock AgentCore Runtime | Hosting the MCP server as a JWT-protected endpoint (McpStack). | none yet | Planned, not deployed |
| AWS Amplify Hosting | Hosting the Next.js console (HostingStack). | none yet | Planned, not deployed (the console runs locally) |

Every resource the CDK app creates is tagged `Project=visitproof` (`infra/lib/stacks.ts`).

## What Is Deployed Now

Region `us-east-1`, environment `dev` (the default in `infra/lib/config.ts`), deployed on 22 October 2026. Physical names with random suffixes are in each stack's CloudFormation resources and outputs.

| Stack | Status | What it runs |
|---|---|---|
| `CDKToolkit` | CREATE_COMPLETE | CDK bootstrap (qualifier `hnb659fds`): asset bucket, asset repository, and deploy roles. |
| `VisitProof-dev-Data` | CREATE_COMPLETE | Table `visitproof` with its stream, the media bucket, the token key `alias/visitproof-ring-tokens`, and the ledger signing key `alias/visitproof-ledger-signing`. |
| `VisitProof-dev-Observability` | CREATE_COMPLETE | Alerts topic (no subscribers) and the budget `visitproof-monthly`. |
| `VisitProof-dev-Webhook` | CREATE_COMPLETE | HTTP API with `POST /ring/webhook` (stack output `RingWebhookUrl`), the receiver Lambda, its DLQ, and the 5xx and error alarms. The receiver runs with `VISITPROOF_MODE=live`. |
| `VisitProof-dev-Engine` | CREATE_COMPLETE | Event processor on the table stream (with DLQ), visit sweeper every minute, daily digest at 23:00 UTC. `MODEL_PROVIDER=bedrock` with `global.amazon.nova-2-lite-v1:0`. No SES permission because `sesFromAddress` is unset. |

Deployed with defaults except the Ring signing key parameter: no `alertEmail`, no `sesFromAddress`, no Bedrock guardrail. The webhook URL has not been registered with Ring, so no real Ring traffic reaches it yet.

## Verified End To End On 22 October 2026

A synthetic Ring v1.1 `button_press` webhook (synthetic account, device, and request ids, never a real Ring call) was signed as `x-signature: sha256=<hex HMAC-SHA256 of the raw body>`, the same scheme as `signWebhookBody` and `verifyWebhookSignature` in `packages/ring-partner-sdk`, and posted to the deployed URL.

1. **Webhook signature check.** The signed request returned 202 with `unclaimed: true` in 815 ms. An unsigned request, a wrong key, and a tampered body under a valid signature each returned 401. Re-sending the same request id returned 202 with `duplicate: true`, so the idempotency receipt works.
2. **DynamoDB.** The door event was stored under the unclaimed bucket for the unlinked Ring account (`type ding`, provenance `ring_webhook`, because live mode ignores the emulated provenance header by design), next to a `WEBHOOK#<requestId>` receipt with a TTL.
3. **Stream and engine.** The stream event source mapping (INSERT plus `EVENT#` filter, batch item failures) invoked the event processor once (976 ms, 0 errors, 0 throttles).
4. **KMS ledger.** The processor appended `LEDGER#000000000001` (previous hash `genesis`) signed with ECDSA by the `alias/visitproof-ledger-signing` key, which proves the stream, the engine, and the `kms:Sign` grant work together.
5. **Sweeper and schedules.** The sweeper rule runs every minute with 0 errors and 0 throttles; the daily digest rule is enabled.
6. **Alarms and budget.** Both webhook alarms exist and stayed in state OK; the budget showed 0 USD actual spend. Both DLQs held 0 messages.
7. **Bedrock.** One minimal Converse call to `global.amazon.nova-2-lite-v1:0` failed with `ThrottlingException` ("Too many tokens per day"). Every Nova 2 Lite on-demand and cross-region quota in the account is 0, and the per day quota is not adjustable from Service Quotas. No model narrative has been generated in AWS; the template fallback applies. Raising the quotas needs an AWS Support case, or deploy with `-c modelProvider=fixture`.
8. **Cleanup.** The three synthetic items (event, ledger record, receipt) were deleted and the table was left empty. No errors appeared in any log group afterwards.

Gaps found during the check: nothing alarms yet on event processor or sweeper errors, stream iterator age, or messages in either DLQ, so an engine failure would be silent until those alarms are added.

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

### How It Was Deployed On 22 October 2026

1. Signed in with `aws login --profile visitproof --region us-east-1`, which stores temporary credentials from a console session in the named profile and refreshes them. No access keys were created. That session belonged to the account root user, which works but is not the recommended identity (see below).
2. Ran `pnpm --filter infra test`, `typecheck`, `lint`, and an offline `cdk synth --no-lookups`.
3. Exported the profile's temporary credentials only into each CDK command's environment, so the CDK CLI received plain temporary credentials and nothing was written to disk:

   ```
   env $(aws configure export-credentials --profile visitproof --format env-no-export | xargs) \
     AWS_REGION=us-east-1 pnpm --filter infra exec cdk <command>
   ```

4. Bootstrapped once: `cdk bootstrap aws://ACCOUNT_ID/us-east-1` (the `CDKToolkit` stack did not exist before).
5. Deployed in dependency order with `--exclusively --require-approval never`: Data and Observability, then Webhook, then Engine. The Ring signing key was read from the git-ignored `.env` into the environment of that one command and passed as the NoEcho parameter `VisitProof-dev-Webhook:RingHmacSigningKey`. It was never printed or committed.

All four stacks reached CREATE_COMPLETE on the first attempt, with no code changes.

### Recommended Identity For The Next Deploy

Prefer short-lived credentials from **IAM Identity Center**, or `aws login` as a non-root IAM identity. **Never use root access keys.** If the account root user has access keys, delete them in the IAM console (Security credentials). The root user cannot assume the `cdk-hnb659fds-*` roles, so the CLI deployed with the session credentials directly; a non-root identity uses the roles as intended.

1. Create credentials.
   - IAM Identity Center: create a user, and two permission sets. `VisitProofBootstrap` (AdministratorAccess, 1 hour sessions) is used once for `cdk bootstrap`. `VisitProofDeploy` holds only the policy below. Run `aws configure sso` and name the profiles `visitproof-bootstrap` and `visitproof-deploy`.
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

3. Optional: verify the SES sender (and, in the SES sandbox, every recipient) in the SES console if you want the digest to mail.
4. Bootstrap once (already done for this account and region): `pnpm --filter infra exec cdk bootstrap aws://ACCOUNT_ID/us-east-1 --profile visitproof-bootstrap`
5. Synthesize and review: `pnpm --filter infra exec cdk synth --no-lookups`
6. Deploy:

   ```
   pnpm --filter infra exec cdk deploy --all --profile visitproof-deploy \
     -c alertEmail=you@example.com \
     -c sesFromAddress=alerts@example.com \
     --parameters VisitProof-dev-Webhook:RingHmacSigningKey=YOUR_RING_SIGNING_KEY
   ```

   `alertEmail` and `sesFromAddress` are optional; the 22 October deploy left both unset. Other context: `environment`, `region`, `agencyId`, `modelProvider` (`bedrock` or `fixture`), `bedrockModelId`, `bedrockGuardrailId` with `bedrockGuardrailVersion`, `sesAllowedRecipients`, `budgetLimitUsd`.
7. When ready for real traffic, paste the `RingWebhookUrl` stack output into the Ring Developer Portal. This has not been done.

Known limits of this first version:

- The webhook signing key is a NoEcho CloudFormation parameter that lands in plain text in the receiver Lambda environment. Moving it to SSM Parameter Store (SecureString) or Secrets Manager needs a change in `apps/webhooks`.
- The webhook DLQ only receives failed asynchronous invocations; API Gateway invokes synchronously, so receiver failures surface through the 5xx alarm.
- The digest runs at one fixed UTC hour, not at each family's `digestHour`.
- Only the webhook has alarms; engine errors, stream iterator age, and DLQ depth are not alarmed yet.

## How To Tear Down

Run each command with the same credentials used to deploy (for `aws login`, the `env $(aws configure export-credentials ...)` wrapper above).

1. Stop the per minute sweeper and the public endpoint first, then the rest:

   ```
   pnpm --filter infra exec cdk destroy VisitProof-dev-Engine VisitProof-dev-Webhook
   pnpm --filter infra exec cdk destroy VisitProof-dev-Observability VisitProof-dev-Data
   ```

2. Delete what the stacks retain by design (`RemovalPolicy.RETAIN` in `infra/lib/data-stack.ts`, and the CDK default for log groups):
   - **DynamoDB table `visitproof`.** Deletion protection is on. Turn it off, then delete the table, which also ends its point-in-time recovery backups:

     ```
     aws dynamodb update-table --table-name visitproof --no-deletion-protection-enabled
     aws dynamodb delete-table --table-name visitproof
     ```

   - **S3 media bucket** (name starts with `visitproof-dev-data-mediabucket`). Empty it, then delete it: `aws s3 rb s3://BUCKET_NAME --force`.
   - **KMS keys** `alias/visitproof-ring-tokens` and `alias/visitproof-ledger-signing`. Each costs about 1 USD a month until deleted. Schedule deletion (7 to 30 days; billing stops when the key is scheduled): `aws kms schedule-key-deletion --key-id KEY_ID --pending-window-in-days 7`. Once the ledger key is gone, existing ledger signatures can no longer be verified with KMS, so export what you need first.
   - **CloudWatch log groups** for the four functions (names start with `VisitProof-dev-`). Delete them in the CloudWatch console or with `aws logs delete-log-group`.
3. Optional: delete the `CDKToolkit` stack and then empty and delete its `cdk-hnb659fds-assets-*` bucket and container repository, which the bootstrap stack retains. Keep it if you will deploy again.

## Cost Estimate

Monthly, for the demo agency (a handful of clients, a few visits a day), with the four stacks deployed all month. These are estimates from public on-demand prices, not observed bills; the budget showed 0 USD actual spend on 22 October 2026.

Cost drivers that run whether or not anyone uses the app: the two KMS keys, the visit sweeper (every minute), and CloudWatch alarms and logs.

| Item | Estimate |
|---|---|
| KMS: two customer managed keys at 1 USD each, plus requests (keys are retained, so they keep costing until deletion is scheduled) | about 2 USD |
| Lambda: sweeper 43,200 runs a month (about 0.05 to 0.5 s each at 256 MB on an empty table) plus 43,200 EventBridge invocations, plus the other functions | inside the free tier, otherwise under 1 USD |
| DynamoDB on-demand, streams, PITR on a few MB (PITR grows with data) | under 1 USD |
| API Gateway HTTP API | under 0.10 USD |
| S3 (small snapshots, 7 day default retention) | under 0.10 USD |
| Bedrock Nova 2 Lite (about 400 tokens per narrative, a few per day); 0 today because the quotas are 0 | under 0.10 USD |
| SES (0.10 USD per 1,000 messages); not configured today | 0 USD |
| CloudWatch (two alarms, two week logs) | about 0.50 USD |
| SQS, SNS, EventBridge schedules, AWS Budgets (first two budgets free) | about 0 USD |
| **Total** | **about 3 to 5 USD per month** |

The budget alerts at 50 USD and 100 USD sit far above this, so they catch mistakes (a runaway loop, a forgotten large resource) rather than normal use. They publish to the SNS topic, which has no subscribers yet, so subscribe an email (`-c alertEmail=...`) or check the Budgets console.

## How Kiro Was Used

Kiro steering, specs, hooks, and MCP settings are committed under `.kiro/`:

- `.kiro/steering/product.md`, `tech.md`, `structure.md`, and `ui-rules.md` carry the product rules, stack, layout, and design system rules.
- `.kiro/specs/presence-engine/requirements.md` states the Presence Engine rules in EARS form. The engine handlers in `apps/engine` apply rule 4 (late and no show escalation) with the agency's own tolerances, `KmsLedgerSigner` is the signing path for rule 10, and `apps/engine/test` covers both.
- `.kiro/hooks/copy-rules.json` re-reads the requirements before each task and runs the copy rules check on message files.
- `.kiro/settings/mcp.json` connects the shadcn MCP server and the Ring Appstore knowledge MCP server.

Not done yet: Kiro Crew job exports and `LESSONS.md` under `docs/kiro-crew/`, and the `design.md` and `tasks.md` files for the presence-engine spec.
