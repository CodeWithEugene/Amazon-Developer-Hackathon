# VisitProof: Build and Technical Specification

> The engineering contract for the hackathon build. Everything here is specific enough to implement without further decisions: stack and versions, repository layout, environment, data model, the Presence Engine, Ring integration, AWS infrastructure, the MCP server and simulator, every page with its components and buttons, the design system rules (strictly shadcn/ui), testing, CI, deployment, the 26-day schedule, the demo, and the submission. Product intent lives in [solution.md](./solution.md); evidence in [research.md](./research.md).

---

## 1. Stack and Versions (Pinned for the Build)

| Layer | Choice | Version target | Notes |
|---|---|---|---|
| Runtime | Node.js | 22 LTS (Lambda `nodejs22.x`); local Node 26 acceptable | Use `engines` to allow `>=22` |
| Package manager | pnpm | 10 or later (local 11.21) | `packageManager` field set; never npm or yarn |
| Monorepo | Turborepo | 2.x | `turbo.json` pipelines for `dev`, `build`, `test`, `lint`, `typecheck` |
| Web framework | Next.js | 16.3.x (App Router, Turbopack, React Compiler on) | Server Components by default; route handlers for the few browser-facing APIs |
| UI runtime | React | 19.2 | |
| Language | TypeScript | 5.9, `strict`, `noUncheckedIndexedAccess` | |
| Styling | Tailwind CSS | 4.1 | `@import "tailwindcss"`, `@theme inline`, OKLCH tokens |
| Components | shadcn/ui | CLI 4.x, style `base-nova`, base `base` (Base UI 1.6+), base color `neutral`, icons `lucide` | Monorepo init: `pnpm dlx shadcn@latest init -t next --monorepo` |
| Forms | React Hook Form + Zod 4 + `@hookform/resolvers` | latest | `Field` family, `Controller` pattern |
| Tables | `@tanstack/react-table` | 9.x | shadcn Data Table guide |
| Charts | Recharts via shadcn `chart` | 3.x | `ChartContainer` + `ChartConfig` |
| Validation | Zod | 4.x | At every boundary |
| MCP | `@modelcontextprotocol/sdk` | 1.x (implements 2025-11-25 exactly) | Express transport; stateful sessions locally, stateless on AgentCore |
| AWS SDK | `@aws-sdk/client-*` v3 | latest | DynamoDB, S3, KMS, SES, Bedrock Runtime, Rekognition, Scheduler |
| Agents | `@strands-agents/sdk` (TypeScript preview) | latest | Ops copilot; Alexa+ simulator brain; falls back to fixture brain |
| Typed judgments | `@typesafe-ai/sdk` | 0.6+ | `jev-latest`; server-side only |
| Auth | Amazon Cognito user pool (email OTP passwordless for all roles) via `aws-amplify` + `@aws-amplify/adapter-nextjs` | latest | Groups: `agency_admin`, `agency_staff`, `family`, `caregiver` |
| Infra as code | AWS CDK v2 (TypeScript) | latest | One stack per environment |
| Tests | Vitest 3, Playwright 1.5x, `aws-sdk-client-mock` | latest | |
| Lint | ESLint 9 flat config, `eslint-config-next`, Prettier 3 | latest | |
| Email templates | React Email | latest | Rendered server-side, sent via SES |
| PDF | `@react-pdf/renderer` | latest | Evidence packs rendered in a Lambda |
| Dev tooling | Kiro IDE/CLI, Kiro Crew, Claude Code, Amazon Devices Builder Tools MCP (docs), Ring Appstore knowledge MCP, shadcn MCP | | `.kiro/` committed |

Decisions recorded: DynamoDB over Postgres for a fully serverless, free-tier-friendly AWS story; Cognito over Auth.js for the AWS Builder narrative and native passwordless email OTP; Express for the MCP server because the 1.x SDK documents that path and AgentCore Runtime expects `0.0.0.0:8000/mcp`; Amplify Hosting for the console with Vercel as a tested fallback if Next.js 16 support is not confirmed during week one.

---

## 2. Repository Layout

```
visitproof/
├── apps/
│   ├── console/                 Next.js 16: agency console, family portal, caregiver record, Ring endpoints, Ask VisitProof simulator
│   │   ├── app/
│   │   │   ├── (marketing)/     landing, privacy, terms, ring homepage
│   │   │   ├── (auth)/          sign-in, verify code, account link
│   │   │   ├── (agency)/agency/ today, exceptions, clients, caregivers, schedule, reconciliation, reports, exports, settings
│   │   │   ├── (family)/family/ feed, visits, live, privacy, devices
│   │   │   ├── (caregiver)/me/  visits, visit detail
│   │   │   ├── ask/             Alexa+ style simulator
│   │   │   ├── demo/            Demo Studio (emulator control)
│   │   │   └── api/             route handlers: ring/token-exchange, ring/webhook (local), ring/stream, ring/snapshot, ask/turn, demo/*
│   │   ├── components/          feature components (not ui primitives)
│   │   ├── lib/                 server actions, data access, auth helpers
│   │   └── components.json
│   ├── webhooks/                Lambda handler (Hono) for the Ring Webhook URL; local dev server
│   ├── engine/                  Lambda handlers: event processor (DynamoDB Streams), visit sweeper (EventBridge), narrative writer, snapshot fetcher, exporter
│   ├── mcp/                     MCP server (Express + SDK 1.x), conformance tests, AgentCore Dockerfile
│   └── copilot/                 Strands ops copilot (TypeScript) used by the console and the simulator
├── packages/
│   ├── ring-partner-sdk/        published as @visitproof/ring-partner-sdk: client, schemas, webhook verify, nonce, whep, snapshot, emulator, fixtures
│   ├── domain/                  Presence Engine, reconciliation, evidence signing, EVV export, jev judgments, narratives (pure TypeScript)
│   ├── ui/                      shadcn components (components/ui/*), globals.css, theme, hooks, cn re-export
│   ├── db/                      DynamoDB single-table access layer (ElectroDB-style typed entities), repositories
│   └── config/                  shared tsconfig, eslint, prettier, zod env schema
├── infra/                       AWS CDK app: stacks for data, webhooks, engine, mcp (AgentCore), auth, hosting, observability
├── docs/                        info, research, problem, solution, build, friction-log, aws-integrations, compliance, testing-instructions
├── .kiro/                       steering, specs, hooks, settings/mcp.json, crew jobs
├── .github/workflows/           ci.yml, release-sdk.yml
├── turbo.json, pnpm-workspace.yaml, package.json, .env.example, LICENSE.md, README.md
```

File size ceiling 500 lines; functions under 50 lines; domain code has no AWS imports.

---

## 3. Environment and Configuration

`.env.example` (all variables validated with a Zod schema in `packages/config/src/env.ts`; the app refuses to start on an invalid value):

```
# Modes
VISITPROOF_MODE=demo                 # demo = fixtures + emulator; live = Ring Playground or OAuth
NEXT_PUBLIC_APP_URL=http://localhost:3000
VISITPROOF_TIME_ZONE=America/New_York  # agency time zone fallback (the agency record wins)

# Ring (live mode)
RING_CLIENT_ID=
RING_CLIENT_SECRET=
RING_HMAC_SIGNING_KEY=               # also used by the emulator to sign demo webhooks
RING_PLAYGROUND_ACCESS_TOKEN=        # optional 30-minute token for read/live calls (pnpm ring:smoke)
RING_API_BASE=https://api.amazonvision.com
RING_OAUTH_TOKEN_URL=https://oauth.ring.com/oauth/token
VISITPROOF_TOKEN_KEY=                # 32-byte base64 key that encrypts Ring OAuth tokens at rest

# Local demo and services
PORT=3000                            # console
WEBHOOK_PORT=3101                    # webhook receiver (apps/webhooks)
VISITPROOF_DEMO_STORE_PATH=          # local JSON store; pnpm demo defaults to .demo-data/
VISITPROOF_STORE=                    # "dynamo" makes the console use DynamoDB; anything else is local
VISITPROOF_AGENCY_ID=a1              # agency whose consent the webhook receiver enforces
VISITPROOF_DEMO_AGENCY_ID=           # agency for the local servers (default a1)
VISITPROOF_ENGINE_INLINE=true        # false: the receiver only persists; the engine runs elsewhere
VISITPROOF_LEDGER_SECRET=            # local HMAC stand-in for the KMS ledger signer (demo only)
VISITPROOF_SESSION_SECRET=           # signs the demo role cookie; random per process when unset

# AWS
AWS_REGION=us-east-1
DYNAMODB_TABLE=visitproof
S3_SNAPSHOT_BUCKET=
KMS_SIGNING_KEY_ID=
KMS_TOKEN_KEY_ID=
SES_FROM_ADDRESS=
BEDROCK_MODEL_ID=global.amazon.nova-2-lite-v1:0
BEDROCK_GUARDRAIL_ID=
BEDROCK_GUARDRAIL_VERSION=
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
MODEL_PROVIDER=fixture               # fixture (offline) or bedrock

# MCP
MCP_HOST=127.0.0.1                   # 0.0.0.0 for AgentCore Runtime
MCP_PORT=8000
MCP_URL=http://localhost:8000/mcp    # where the console's /ask route connects
MCP_PUBLIC_URL=https://mcp.visitproof.com/mcp
MCP_AUTH_ISSUER=                     # Cognito issuer URL
MCP_DEMO_TOKENS=family-demo-token=family:cli_okoro,agency-demo-token=agency
MCP_ALLOW_ANONYMOUS=                 # 1 allows unauthenticated calls in demo mode only
MCP_ALLOWED_HOSTS=
MCP_ALLOWED_ORIGINS=
MCP_STATELESS=                       # true for stateless Streamable HTTP
```

`TYPESAFE_API_KEY` (read from the shell; never committed) joins the schema when the planned Jev integration lands; nothing reads it today.

Demo mode is the default. Live mode is opt-in per subsystem so partial credentials still work (for example Playground token without AWS).

---

## 4. Data Model (DynamoDB Single Table)

Table `visitproof`, keys `pk`, `sk`, GSI1 (`gsi1pk`, `gsi1sk`) for time-ordered queries, GSI2 for lookups by external id, TTL attribute `expiresAt`. Entities (attributes abbreviated; every entity has `createdAt`, `updatedAt`, `version`):

| Entity | pk | sk | Purpose and key fields |
|---|---|---|---|
| Agency | `AGENCY#id` | `META` | name, state, timezone, tolerances `{ graceMin: 15, escalationMin: 45, earlyDepartureMin: 10, departureQuietMin: 10 }`, retentionDays, evvVendor, notificationDefaults |
| Membership | `USER#cognitoSub` | `AGENCY#id` or `FAMILY#clientId` or `CAREGIVER#id` | role, email, displayName |
| Client | `AGENCY#id` | `CLIENT#id` | name, homeLabel, familyContacts[], ringLinkStatus (`unlinked`, `awaiting`, `linked`, `paused`, `removed`), consent `{ shareWithAgency, snapshotsEnabled, snapshotRetentionDays, digestHour, exceptionAlerts }`, serviceCodes[] |
| RingIntegration | `CLIENT#id` | `RING` | accountId, encryptedTokens (KMS), tokenExpiresAt, refreshTokenIssuedAt, integrationStatus, consentedAt, encryptionState (`clear`, `take`, `e2ee`, `unknown`) |
| Device | `CLIENT#id` | `DEVICE#ringDeviceId` | name, online, capabilities summary, motionRecordingEnabled, hasMotionZone, location `{country, state}`, lastEventAt, role (`front_door`, `other`) |
| Caregiver | `AGENCY#id` | `CAREGIVER#id` | name, mobile, email, evvEmployeeId, magicLinkTokenHash |
| Visit | `CLIENT#id` | `VISIT#startIso#id` (GSI1: `AGENCY#id`, `DATE#yyyy-mm-dd#start`) | caregiverId, serviceCode, scheduledStart, scheduledEnd, authorizedUnits, status, arrival `{at, eventId, source}`, departure `{at, eventId, source}`, observability `{ state, reasons[] }`, reconciliation `{ outcome, clockIn, clockOut, deltaArrivalMin, deltaDepartureMin, gpsDistanceM }`, narrative `{ text, provenance }` |
| DoorEvent | `CLIENT#id` | `EVENT#timestampMs#requestId` | type, subType, deviceId, provenance (`ring_webhook`, `ring_history`, `playground`, `emulated`), raw payload hash, componentIds |
| WebhookReceipt | `WEBHOOK#requestId` | `META` (TTL 30 days) | idempotency record, signature verified, receivedAt, processedAt |
| EVVRecord | `CLIENT#id` | `EVV#clockInIso#id` | caregiverEvvId, serviceCode, clockIn, clockOut, verificationMethod, lat, lng, source (`csv`, `manual`, `caregiver_link`), visitId (after matching) |
| Exception | `AGENCY#id` | `EXC#openedIso#id` (GSI1: `AGENCY#id`, `STATUS#open#openedIso`) | visitId, clientId, kind (`late_no_arrival`, `late_arrival`, `no_show`, `early_departure`, `unobservable`, `contradicted`, `missing_clock_in`, `ambiguous`), state (`open`, `snoozed`, `resolved`), snoozeUntil, resolution `{ by, at, reason, note }` |
| LedgerRecord | `CLIENT#id` | `LEDGER#seq` | column (`observed`, `reported`, `resolved`), subject (visitId or exceptionId), payload hash, prevHash, signature (KMS ECDSA P-256), signerKeyId, at |
| Note | `VISIT#id` | `NOTE#at#id` | author role, text, classification (Jev: `dispute`, `explanation`, `fyi`), confidence |
| Snapshot | `VISIT#id` | `SNAP#at` (TTL per consent) | s3Key, mediaOrigin, labels[], watermarkBandPx, requestedAt, provenance |
| Notification | `USER#sub` | `NOTIF#at#id` | channel, kind, status, dedupeKey (one digest per client per day) |
| AuditLog | `AGENCY#id` | `AUDIT#at#id` | actor, action, subject, ip |
| Invitation | `INVITE#tokenHash` | `META` (TTL 14 days) | clientId, email, kind (`family`, `caregiver`, `staff`) |
| UnclaimedToken | `RINGACCOUNT#accountId` | `UNCLAIMED#at` (TTL 15 min) | encrypted tokens, status |

Access patterns are enumerated in `packages/db/README.md` with the query for each screen.

---

## 5. Ring Integration (Exact Behaviors)

### 5.1 `@visitproof/ring-partner-sdk` (packages/ring-partner-sdk)

Exports (as built; `packages/ring-partner-sdk/README.md` is the reference):

- `RingClient({ baseUrl, getAccessToken, fetch, onRateLimit, onUnauthorized })` with methods `me()`, `devices({ include })`, `device(id)`, `deviceStatus(id)`, `deviceCapabilities(id)`, `deviceConfigurations(id)`, `deviceLocation(id)`, `historyEvents(id, { eventTypes?, pageKey? })` and `historyEventsAll(...)` on `GET /v1/history/devices/{id}/events` (the path verified against the Playground; `event_types` is sent and also applied client-side), `snapshot(id, { type: "at_timestamp" | "latest_in_range", ... })` returning the presigned URL and bytes after following the 303 and mapping 416/425/403/422 to typed errors, `clip(id, {...})`, `whepStart(id, sdpOffer)` returning `{ sdpAnswer, sessionUrl }`, `whepStop(sessionUrl)`, `subscriptions()` (a 422 raises `RingNotAvailableForAccountError`), `appIntegrationConfirm({ nonce, accountIdentifier })`, `appIntegrationComplete()`, `appIntegrationDelete()`.
- `exchangeAuthorizationCode`, `refreshAccessToken`, and `createTokenManager` (single-flight, rotation-aware).
- `verifyWebhookSignature(rawBody: Uint8Array, header: string, key: string): boolean` (constant time, `sha256=` hex) and `parseWebhookLenient` (an unknown `data.type` is kept, not rejected).
- `computeAccountLinkNonce(key, timeMs, accountId)` (URL-safe base64, no padding) and `matchNonce(...)`.
- Zod schemas for webhook v1.1 (`WebhookEnvelope`, discriminated union on `data.type` for all event types including sensors and subscriptions), JSON:API device documents, history events, error documents. Device sub-resources use Ring's real type names (`device-status`, `device-capabilities`, `device-configurations`, `locations`) and accept `null` wherever the Playground returned it.
- `createWhepPeer({ videoEl, signaling, teardown, batteryPowered, onCountdown, onEnded, onStall, onNoVideo })` browser helper (subpath `./whep`) implementing the documented pattern (handlers before `createOffer`, `recvonly`, ICE gathering complete, `getStats` stall detection, keepalive DELETE on `pagehide`), enforcing the 30 s battery and 60 s wired caps with a countdown, and ending a connected session that decodes no video within 8 s with reason `no_video`.
- `cropWatermarkBand(imageData, ratio = 0.15)` for inference only.
- `RingEmulator`: a payload generator (not an HTTP server) that signs v1.1 deliveries. Scenarios: `on_time`, `late_arrival`, `no_show`, `early_departure`, `double_visitor` (delivery before the aide), `device_offline_mid_visit`, `encrypted_device`, `integration_removed`, `ding`, `motion`, `arrival`, `departure`, plus `twoWeeks()` (composite for three clients with per-visit ground truth). `withRedeliveries` adds Ring style resends.
- `fixtures/playground/`: the real Playground responses captured on 22 October 2026 (users/me, devices, the four sub-resources, an empty history page, the subscriptions 422) with a manifest of request paths and status codes.
- `./testing` (not published): `createMockPlaygroundHandler()` and `startMockPlayground()` (127.0.0.1, default port 3271), a mock Ring Playground that serves those fixtures and answers WHEP POST and DELETE.

Packaged for npm (version 0.1.0, Apache-2.0, README, 132 tests, changelog); `visitproof` and `@visitproof/*` names were unregistered as of 27 September 2026.

### 5.2 Ring endpoints in `apps/console`

| Endpoint | Route | Behavior |
|---|---|---|
| Token Exchange URL | `POST /api/ring/token-exchange` | Validate body, exchange code within 60 s, call `me()`, store `UnclaimedToken` encrypted; return 200 in under 2 s |
| Account Link URL | `GET /link?nonce&time` | Freshness check (600 s, not future); render sign-in/create with Ring email pre-filled; after code verification, match nonce, `appIntegrationConfirm`, `appIntegrationComplete`, create `RingIntegration`, redirect to consent |
| App Homepage URL | `GET /ring` | "Account Linked Successfully" or "Link Your Ring" with routes to the portal; never a dead end |
| Webhook URL | `apps/webhooks` (a local Node server in the demo, an API Gateway Lambda in production; the console has no webhook route) | Read raw body, verify signature, 401 on failure, dedupe on `meta.request_id` (conditional put), persist `DoorEvent`, return 202; DynamoDB Streams trigger the engine |
| Stream proxy | `POST /api/ring/stream`, `DELETE /api/ring/stream` | Browser sends SDP; server calls WHEP and keeps the Ring session URL server-side; the browser helper counts down the cap (30 s battery, 60 s wired) and the server registry also stops the session at the cap |
| Snapshot | engine adapter (`apps/engine/src/adapters/ring-snapshot-service.ts`), disabled in the deployed stack until a token store exists | Requested after arrival when consent allows; stored to S3 with watermark intact; an encrypted frame is never stored; Rekognition labels are planned, not built |
| History sync | `POST /api/ring/history` (Sync Ring History on `/family/devices`) | From consent time forward for every shared device, paced at 5 pages per second (200 ms apart, at most 20 pages), deduped on the Ring event id and saved with provenance `ring_history`; an empty result shows "No Ring Events Since Consent" |

### 5.3 Device Check (family onboarding)

Reads `GET /v1/devices?include=status,capabilities,configurations,location` in one call (`apps/console/lib/ring/device-check.ts`) and produces a checklist per shared device with four required items, Online, Motion Recording On, Motion Zone Present, and Encryption State Known (end to end encryption on is a fail), plus Human Detection as an informational item that never counts, because Ring's capabilities do not report person detection. The summary reads "N of M required checks passing"; on the captured Playground doorbell it is 4 of 4. Every item shows what VisitProof observed, why it matters, and where to change it in the Ring app. In demo mode (no token) the page explains that Device Check needs live Ring mode.

---

## 6. The Presence Engine (packages/domain)

Pure functions with injected `now`:

```
normalizeEvent(webhook | historyEvent | emulatedEvent) -> DoorEvent
findVisitWindow(client, event, visits) -> Visit | null
arrivalCandidates(visit, events) -> Candidate[]
chooseArrival(visit, candidates, context) -> { arrival, method: "rule" | "jev", confidence }
detectDeparture(visit, events, quietMin) -> Departure | "not_observed"
classifyVisit(visit, now, tolerances, observability) -> Status
assessObservability(visit, deviceStates, integration, encryption) -> { state, reasons }
reconcile(visit, evvRecords, tolerances) -> ReconciliationOutcome
raiseExceptions(previous, current) -> Exception[]
signLedger(record, prev, signer) -> LedgerRecord
buildEvidencePack(client, range) -> EvidencePack
toOpenEvvVisit(visit) -> OpenEvvVisitJson
```

Status machine: `scheduled` to `awaiting_arrival` (window opened) to `arrived_on_time` | `arrived_late` | `no_show`; then `in_progress` to `completed` | `early_departure` | `departure_not_observed`; overlay `unobservable` with reasons at any point; `ambiguous` routes to a human and resolves to any of the above.

Jev questions (server-side, `packages/domain/judgments.ts`):

- `chooseArrival`: Choice over candidate clusters with state `{ scheduledStart, candidates: [{ at, kind, dwellSec, labels, precededByVehicle }], caregiverUsualArrivalOffsetMin }`; accept when confidence at least 0.7, else `ambiguous`.
- `classifyNote`: Choice `{ dispute, explanation, fyi }` over the note text plus visit context.
- `suggestReason`: Choice over the agency's reason-code list for an exception (suggestion only; the human confirms).
- `isDeliveryLike`: Noul on a cluster ("short dwell, package or vehicle labels, no scheduled visit").

All judgments are logged with inputs and outputs for the evidence trail and are replayable from fixtures without calling the API in tests.

Narratives: `packages/domain/src/narratives.ts` builds the deterministic template (times in the agency time zone, for example "8:04 AM ET") and validates text against rules (must contain the arrival time, must be under 60 words, must not contain names other than the caregiver's). `apps/engine/src/adapters/bedrock-narrator.ts` sends Bedrock Nova 2 Lite the template as a draft plus statuses and agency-local times only, with a system prompt that forbids added facts, names, health details, guesses, and dashes and optional Guardrails; any failure, intervention, or rule violation falls back to the template with `provenance: "template"`. The demo uses the template only.

---

## 7. AWS Infrastructure (infra/, CDK)

| Stack | Resources | Notes |
|---|---|---|
| `DataStack` | DynamoDB table (on-demand, streams, TTL, PITR), S3 snapshot bucket (SSE-KMS, 7-day default lifecycle, block public), KMS keys (token encryption symmetric; ledger signing ECDSA P-256 asymmetric) | Tag `Project=visitproof` |
| `AuthStack` | Cognito user pool with email OTP passwordless, groups, app clients (console; MCP resource server with PKCE S256 and static client) | Hosted UI domain for the MCP OAuth flow |
| `WebhookStack` | API Gateway HTTP API `POST /ring/webhook`, Lambda (arm64, 256 MB, 5 s timeout), DLQ, alarm on 5xx | Public HTTPS URL is the Ring Webhook URL |
| `EngineStack` | Lambdas: `event-processor` (DynamoDB Streams), `visit-sweeper` (EventBridge rule every minute), `narrative-writer`, `snapshot-fetcher`, `exporter` (PDF, JSON), `mailer` (SES) | Bedrock, Rekognition, KMS, S3 permissions least privilege |
| `McpStack` | AgentCore Runtime agent (protocol MCP, `CUSTOM_JWT` against Cognito discovery URL), Lambda fallback via Function URL (stateless mode) | `agentcore deploy` from `apps/mcp` |
| `HostingStack` | Amplify Hosting app connected to GitHub (`apps/console`), env vars, custom domain | Vercel fallback documented |
| `ObservabilityStack` | CloudWatch dashboards, alarms, AgentCore Observability, AWS Budgets ($50, $100) | Screenshots for the README |

`docs/aws-integrations.md` lists every service with purpose, file path, and observed cost, plus the architecture diagram. Everything is torn down between sessions except DynamoDB, S3, Cognito, and Amplify.

---

## 8. MCP Server and Ask VisitProof (apps/mcp, apps/console/app/ask)

### 8.1 Server

- Express app; `POST/GET/DELETE /mcp`; `GET /health`; `GET /.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (pointing at Cognito); `requireBearerAuth` verifying Cognito JWTs (audience = MCP URL) or demo tokens in demo mode; `enableDnsRebindingProtection` with allowed hosts and simulator origins; stateful sessions locally, `sessionIdGenerator: undefined` and `enableJsonResponse: true` on serverless; version negotiation for `2025-03-26` and `2025-11-25`; `instructions` with voice style rules.
- Tools (names stable, single intent, `outputSchema` with a `spoken` string, `structuredContent`, `isError` execution errors, annotations honest):

| Tool | Args | Scope | Behavior |
|---|---|---|---|
| `get_visit_status` | `clientId?`, `date?` | family, agency | Today's visit status for a client with times and reconciliation summary |
| `list_visits` | `date`, `status?`, `clientId?` | agency, family (own client) | At most 5 items in voice, more in structured content |
| `list_exceptions` | `date?`, `state?` (`open`, `snoozed`, `resolved`, `any`), `kind?`, `days?` | agency | Exceptions ranked by severity; open by default |
| `explain_visit` | `visitId` | family, agency, caregiver (own) | Evidence timeline in plain language, three columns |
| `get_client_summary` | `clientId`, `range` | family, agency | Reliability over a range |
| `acknowledge_exception` | `exceptionId`, `reason`, `confirmed` | agency | Confirmation required (elicitation or `confirmed`) |
| `add_visit_note` | `visitId`, `text`, `confirmed` | family, caregiver, agency | Signed into the Reported column |

- Write tools answer with a status: `done`, `confirmation_required`, `declined`, or `already_resolved`. The earlier `export_evidence` tool was removed; evidence packs come from the console export.
- Resources: `visitproof://schedule/{clientId}/{date}` (JSON), `visitproof://feed/{clientId}/today` (text). Prompt: `morning_briefing(clientId)`.
- MCP Apps (optional, day 18+): `ui://visitproof/visit-card.html` returned via `_meta.ui.resourceUri` for Echo Show rendering.
- Conformance tests (`pnpm mcp:conformance`): initialize both versions, session headers, 202 on notifications, 404 on unknown session, 403 on bad Origin, 401 unauthenticated, tools/list, each tool with fixtures, structured output validation.

### 8.2 Ask VisitProof simulator (`/ask`)

Mirrors Amazon's web simulator layout: left conversation (shadcn chat components `MessageScroller`, `Message`, `Bubble`), "Ask VisitProof" input with optional browser speech recognition, right panel device preview (Echo Show small and large toggle via `ToggleGroup`) rendering the structured content as a Card, bottom `Tabs`: Visual (opens first), Trace (timings, with readable step titles such as "Tool Call: Visit Status"), and Response Detail (tool call JSON, labeled as protocol data with code-form tool names and UTC timestamps). Everywhere else on the page, tool names show as readable titles such as "Visit Status". Brain: Strands agent with the MCP client over Streamable HTTP (`MODEL_PROVIDER=fixture` uses golden-utterance mappings offline). Golden utterances in `apps/mcp/test/golden.json` map phrases to expected tool selections and run with `pnpm --filter @visitproof/copilot test` against the fixture brain (Nova 2 Lite runs are planned).

---

## 9. Pages, Components, and Buttons

Conventions for every page: shell from `sidebar-07` (agency) or a mobile-first single column with a top bar (family, caregiver); page header with h2 recipe (`scroll-m-20 text-3xl font-semibold tracking-tight`), description in `text-muted-foreground`; `Breadcrumb` in the site header; every list has an `Empty` state; every async region has a `Skeleton`; every mutation shows a `toast.add(...)`; destructive actions use `AlertDialog` with `variant="destructive"` on the action; status chips are `Badge` with a lucide icon and `sr-only` text; all button labels in Title Case.

Status badge mapping (single source `packages/ui/src/components/status-badge.tsx`):

| Status | Badge variant | Icon |
|---|---|---|
| On Time, Completed, Corroborated | `default` | `CircleCheck` |
| Late, Early Departure, Missing Clock-In | `warning` (added token and variant) | `Clock` |
| No Show, Contradicted | `destructive` | `CircleAlert` |
| Unobservable, Awaiting, Paused | `secondary` | `EyeOff` |
| Ambiguous, Needs Review | `outline` | `CircleHelp` |

### 9.1 Marketing and shared

| Route | Purpose | Components | Buttons |
|---|---|---|---|
| `/` | Landing: pitch, how it works, boundaries, plans | `Card`, `Badge`, `Accordion` (FAQ), `Separator` | **Start Free Pilot**, **See The Demo**, **Open In Ring Appstore** |
| `/privacy`, `/terms` | Policies (required by Ring listing) | Typeset (`typeset-docs`) | none |
| `/ring` | App Homepage URL | `Alert`, `Card` | **Continue To Family Portal**, **Sign In**, **Create Account** |
| `/sign-in` | Email code sign-in | `Card`, `FieldGroup`, `Input`, `InputOTP` | **Send Code**, **Verify Code**, **Use A Different Email** |
| `/link` | Account Link URL (nonce) | `Card`, `Alert` (freshness errors), `Field`, `Input` (pre-filled email), `InputOTP` | **Create Account**, **I Already Have An Account**, **Verify Code** |
| `/demo` | Demo Studio (labeled Simulator) | `Card`, `Select` (scenario), `Slider` (speed), `ButtonGroup`, `Table` (event log), `Switch` (device offline, encrypted) | **Run Scenario**, **Send Doorbell Press**, **Send Human Motion**, **Take Device Offline**, **Reset Demo Data** |

### 9.2 Agency Console (`/agency/*`, sidebar: Today, Exceptions, Clients, Caregivers, Schedule, Reconciliation, Reports, Exports, Settings; footer: user menu)

| Route | Purpose | Layout and components | Buttons and actions |
|---|---|---|---|
| `/agency/today` | Live board | Section cards (Visits Today, In Progress, Exceptions Open, Unlinked Clients) using `Card` + `Badge` trend; `Tabs` (All, In Progress, Upcoming, Done); data table of visits (client, caregiver, window, door status, clock-in, status badge, actions); row click opens `Sheet` with the visit timeline | **Refresh** (icon), **Open Exception**, **View Visit**, **Backfill**, **Add Note** |
| `/agency/exceptions` | Queue | `Tabs` (Open, Snoozed, Resolved), `ItemGroup` of exception `Item`s with `ItemMedia` icon, title, description, `ItemActions`; detail `Sheet` with evidence timeline, caregiver contact, `Select` reason, `Textarea` note | **Call Caregiver** (tel link), **Backfill**, **Snooze 10 Minutes**, **Resolve**, **Request Caregiver Note** |
| `/agency/clients` | List and detail | Data table (name, home, Ring status badge, devices, family contact, last visit); `Dialog` add client with `FieldGroup`; `/agency/clients/[id]` with `Tabs` (Overview, Devices, Visits, Consent, Evidence) | **Add Client**, **Import CSV**, **Invite Family To Link Ring**, **Resend Invitation**, **Pause Ingestion**, **Export Evidence** |
| `/agency/caregivers` | List and detail | Data table (name, EVV id, reliability badge, visits this week); `Dialog` add; detail with reliability chart | **Add Caregiver**, **Import CSV**, **Send Record Link** |
| `/agency/schedule` | Import and calendar | `Card` upload with `InputGroup` file, mapping preview `Table`, `Calendar` (week view via `mode="range"` and a list per day), recurring visit `Dialog` | **Upload Schedule**, **Map Columns**, **Import Visits**, **Add Visit**, **Download Sample CSV** |
| `/agency/reconciliation` | EVV join | Filters `ToggleGroup` (All, Corroborated, Contradicted, Missing Clock-In, Missing Both, Unobservable); data table (client, caregiver, door arrival, door departure, clock-in, clock-out, delta, outcome badge); detail `Sheet` | **Import EVV Export**, **Mark Ready For Visit Maintenance**, **Request Caregiver Note**, **Export Selected** |
| `/agency/reports` | Analytics | Two charts in `Card`s: on-time rate by week (`chart-line-default` pattern, `--chart-1`), exceptions by kind (`chart-bar-stacked`, `--chart-2..5`); reliability table per caregiver; `Select` date range | **Download CSV**, **Change Range** |
| `/agency/exports` | Evidence | `Card`s: Evidence Pack (PDF), Alternate EVV JSON, Ledger Verify tool; history `Table` with signatures | **Generate Evidence Pack**, **Export Alternate EVV JSON**, **Verify A Pack** |
| `/agency/settings` | Config | `Tabs` (Agency, Tolerances, Notifications, Team, EVV Vendor, Data Retention, Integrations); forms with `FieldSet`, `Slider` for tolerances with `FieldDescription`, `Switch`es, `NativeSelect` for state | **Save Changes**, **Invite Team Member**, **Regenerate Magic Links**, **Delete Agency** (AlertDialog) |
| `/agency/copilot` (in sidebar as Ask) | Ops copilot | Chat components with tool-call `Marker`s | **Send**, suggested prompt chips (`Badge` as buttons) |

### 9.3 Family Portal (`/family/*`, top bar with client switcher `Select` and user menu)

| Route | Purpose | Components | Buttons |
|---|---|---|---|
| `/family/link` | Post-link consent | `Questionnaire` (3 steps: What Is Shared, Snapshots, Notifications) | **Next**, **Back**, **Finish Setup** |
| `/family/devices` | Device Check (live Ring mode) | Provenance `Badge`, one `Card` per shared device with an `ItemGroup` checklist, a state `Badge` per item, and the Ring app path for every item not passing | **Sync Ring History** |
| `/family` | Feed | One `Card` per day (title with date, `Badge` status, arrival and departure, narrative, optional snapshot `AspectRatio` image with provenance caption); `Empty` before the first visit | **View Details**, **Report A Problem** |
| `/family/visits/[id]` | Visit detail | Timeline `Item`s (Observed, Reported, Resolved columns as `Tabs`), snapshot, notes | **Add Note**, **Share With Agency** (toggle), **Download Evidence** |
| `/family/live` | Live view (live Ring mode) | Video, countdown `Progress` ("Live View Time Left"), provenance label, and an `Alert` titled "Connected To Ring, But No Video Arrived" when no frame decodes within 8 s | **Start Live View**, **Stop Live View** |
| `/family/privacy` | Consent and data | `FieldSet` toggles, retention `Select`, export and delete | **Save**, **Export My Data**, **Pause Sharing**, **Delete Everything** (AlertDialog) |

### 9.4 Caregiver Record (`/me/*`, magic link)

| Route | Purpose | Components | Buttons |
|---|---|---|---|
| `/me` | My visits | `ItemGroup` by day with door times, clock-in times, outcome badge | **Add Note**, **Open** |
| `/me/visits/[id]` | Detail | Three-column `Tabs`, note form `Field` + `Textarea` | **Submit Note**, **Mark As Dispute** |

### 9.5 Emails (React Email, SES)

Family invitation; Account Linked; Daily Digest (one per client per day, dedupe key); Exception Alert (late, no-show); Caregiver Record Link; Note Requested; Evidence Pack Ready; Data Deleted. Subjects and headings in Title Case; no dashes; one-click unsubscribe for non-critical emails.

---

## 10. Design System Rules (Strictly shadcn/ui)

1. Initialize with `pnpm dlx shadcn@latest init -t next --monorepo` then set `style: "base-nova"`, `base: "base"`, `baseColor: "neutral"`, `iconLibrary: "lucide"`, `cssVariables: true`, `rsc: true` in every `components.json`; run `pnpm dlx shadcn@latest info --json` and commit the output to `docs/shadcn-info.json`.
2. Add components only with `pnpm dlx shadcn@latest add <name> -c apps/console`; the CLI routes `registry:ui` items to `packages/ui`. Initial set: `sidebar breadcrumb separator button badge card tabs table sheet dialog alert-dialog drawer dropdown-menu select native-select combobox command input input-group input-otp textarea field checkbox switch radio-group slider toggle-group calendar popover tooltip toast skeleton empty item kbd spinner progress avatar alert scroll-area chart aspect-ratio questionnaire message-scroller message bubble marker`.
3. Tokens only. Two added intents in `packages/ui/src/globals.css`: `--warning`/`--warning-foreground` (light `oklch(0.84 0.16 84)` / `oklch(0.28 0.07 46)`; dark `oklch(0.41 0.11 46)` / `oklch(0.99 0.02 95)`) and `--success`/`--success-foreground` (light `oklch(0.5 0.14 150)` / `oklch(0.98 0.02 150)`; dark `oklch(0.52 0.14 150)` / `oklch(0.98 0.02 150)`), mapped in `@theme inline`, and added as `warning` and `success` variants to `badge.tsx` and `alert.tsx` only. For AA contrast the light `--destructive` is `oklch(0.52 0.21 27.325)`. No other color overrides anywhere.
4. Base UI composition: `render` not `asChild`; `Select` with `items`; `ToggleGroup` and `Accordion` with `multiple` and array values; `Slider` numbers for single thumbs; toasts via `toast.add` from `@/components/ui/toast`; `Combobox` first-class.
5. Layout only via className (`flex gap-4`, `grid`, `max-w-*`); never `space-*`; `size-*` for squares; `cn()` from `"cn"` for conditionals.
6. Forms: `FieldGroup` > `Field` > `FieldLabel` + control + `FieldDescription` + `FieldError`, React Hook Form `Controller`, Zod resolver; `InputGroup` for adorned inputs; `FieldSet` + `FieldLegend` for groups.
7. Overlays by intent: `Dialog` (tasks), `AlertDialog` (destructive), `Sheet` (details and filters), `Drawer` (mobile), `Popover` (small), `Tooltip` (hints) with `TooltipProvider` at the root.
8. Lists: `Item`/`ItemGroup` for rows, `Empty` for empty states, `Skeleton` for loading, `Badge` for status, `Separator` for dividers, `Kbd` for shortcuts (`Cmd+B` sidebar, `Cmd+K` command palette via `CommandDialog`).
9. Data: `Table` + TanStack Table v9 (sorting, filtering, pagination, row selection, column visibility via `DropdownMenuCheckboxItem`); charts via `ChartContainer` with `ChartConfig` and `accessibilityLayer`, wrapped in `Card` with `CardFooter` trend text.
10. Typography: documented recipes only; page titles h2 recipe; section titles h3/h4; `text-muted-foreground` for descriptions; Typeset for policy pages.
11. Dark mode via `next-themes` (`attribute="class"`, `enableSystem`), `ModeToggle` in the user menu; no manual `dark:` overrides.
12. Copy: Title Case for titles, headings, and buttons; sentence case body; no em or en dashes anywhere in user-facing text; Ring terminology per the UX guide.
13. Accessibility: WCAG 2.2 AA; every icon-only button has `sr-only` text or `aria-label`; focus visible; `prefers-reduced-motion` respected; status never conveyed by color alone.
14. Code review checklist item: "Could this be a shadcn component or variant instead of custom markup?" If yes, it must be.

---

## 11. Testing Strategy

| Layer | Tool | What | Gate |
|---|---|---|---|
| Domain unit | Vitest | Presence Engine on every scenario fixture, reconciliation matrix, ledger chain and signature verification, Open EVV JSON shape, narrative validators, Jev judgment adapters (recorded answers) | 80% coverage on `packages/domain`, CI required |
| SDK unit | Vitest | Webhook signature (positive, tampered, wrong key, replay), nonce encoding, 303/416/425 handling, history pagination and client-side filtering, WHEP helper state machine (jsdom) | CI required |
| Integration | Vitest + emulator | Emulator sends signed webhooks to the local receiver; events flow to the engine; visits change status; exceptions open and resolve; digests dedupe | CI required |
| MCP conformance | Vitest over HTTP | Transport rules for 2025-03-26 and 2025-11-25, auth, tools, structured output, golden utterances with fixture brain | CI required |
| E2E | Playwright | Judge quick start: sign in as each role, run the two-week scenario, verify Today board, exception resolution, family feed, caregiver note, export download, simulator turn | CI required on `main` |
| Accessibility | Playwright + axe | Every route at desktop and mobile widths | Warnings fail on `main` |
| Live smoke (manual) | `pnpm ring:smoke` | Playground token: users/me, devices, status, capabilities, configurations, location, one history page, subscriptions; prints PASS, INFO, or FAIL and the Device Check summary; records redacted fixtures. Snapshot and WHEP are not part of it. Ran on 22 October 2026 | Before the video; the mock Ring Playground replays the fixtures offline |
| Load | k6 (small) | Webhook receiver 100 rps for 60 s, p95 under 100 ms | Once before submission |

Last verified run (22 October 2026): `pnpm -r test` passes 664 of 664 tests (config 5, ring-partner-sdk 132, domain 140, db 36, mcp 61, infra 17, engine 53, copilot 43, webhooks 22, console 155), and `pnpm test:scripts` passes 18 of 18: 682 tests in all. `packages/domain` statement coverage is 99.2 percent.

Definition of done per feature: tests written first for domain logic, storybook-free visual check in the browser at 390 px and 1440 px, empty and error states present, copy rules pass a lint script (`pnpm lint:copy` greps for dashes and lowercase button labels in `messages/*.ts`).

---

## 12. CI and Delivery

- `.github/workflows/ci.yml`: pnpm install with frozen lockfile, lint, typecheck, unit, integration (emulator), MCP conformance, build all apps, upload Playwright report; secrets never required for CI (demo mode).
- `.github/workflows/release-sdk.yml`: on tag `sdk-v*`, build and publish `@visitproof/ring-partner-sdk` with provenance.
- Dependabot for npm and actions. License header check. Secret scan (gitleaks).
- Branch protection on `main`; conventional commits; no Co-Authored-By trailers.
- Deployments: Amplify Hosting auto-deploys `main`; `cdk deploy` for backend stacks from a local machine with the hackathon AWS account; `agentcore deploy` for the MCP server; a `pnpm deploy:teardown` script removes engine, webhook, and MCP stacks between sessions.

---

## 13. Kiro and Kiro Crew Usage (AWS Builder evidence)

- `.kiro/steering/product.md`, `tech.md`, `structure.md` (inclusion always) and `ui-rules.md` (fileMatch `**/*.tsx`) carrying the design system rules.
- `.kiro/specs/presence-engine/{requirements,design,tasks}.md`, `.kiro/specs/ring-integration/...`, `.kiro/specs/mcp-server/...` in EARS style.
- `.kiro/hooks/`: lint on save, "re-read requirements before task", copy-rule check on message file save.
- `.kiro/settings/mcp.json`: shadcn MCP, Ring Appstore knowledge MCP, Amazon Devices Builder Tools MCP (docs search), VisitProof's own MCP (local).
- Kiro Crew jobs: nightly `pnpm test` with summary; Issue Radar triage; Task Runner executing the presence-engine spec. Activity exports go to `docs/kiro-crew/` with a `LESSONS.md`.
- Claude Code is also used; `.claude/` config and `.mcp.json` are committed where they contain no secrets.

---

## 14. Twenty-Six-Day Schedule (27 September to 23 October 2026)

| Days | Dates | Deliverables |
|---|---|---|
| 1 to 2 | Sep 27 to 28 | Ring developer registration (government ID; exact legal name), Playground token; AWS account, credits form, budgets; monorepo scaffold with shadcn init, tokens, app shell; SDK package skeleton with schemas and signature verification (tests first) |
| 3 to 5 | Sep 29 to Oct 1 | Emulator with all scenarios and control plane; webhook receiver (local and Lambda); DynamoDB table and repositories; Presence Engine core statuses with fixtures |
| 6 to 8 | Oct 2 to 4 | Agency Console: Today board, Exceptions queue, Clients, Caregivers, Schedule import; Visit Sweeper; email notifications (fixture transport) |
| 9 to 10 | Oct 5 to 6 | Family Portal: link flow (nonce, endpoints), consent questionnaire, Device Check, feed, visit detail; Ring App Homepage; Cognito passwordless |
| 11 to 12 | Oct 7 to 8 | Reconciliation: EVV CSV import, outcome matrix, detail sheet; Caregiver Record and notes; Jev judgments wired with recorded fixtures |
| 13 to 14 | Oct 9 to 10 | Ledger signing, Evidence Pack PDF, Alternate EVV JSON, offline verifier; Reports charts |
| 15 | Oct 11 | Integration week starts: Bedrock narratives with Guardrails, Rekognition labels, snapshot fetcher, S3 lifecycle; Playground live smoke; WHEP live view |
| 16 | Oct 12 | **Feature freeze for the Ring primary.** MCP server tools, resources, prompt; conformance tests |
| 17 to 18 | Oct 13 to 14 | Ask VisitProof simulator; Strands ops copilot; AgentCore deploy; golden utterances |
| 19 | Oct 15 | Amplify Hosting deploy (or Vercel fallback), CDK stacks, observability screenshots, cost table |
| 20 | Oct 16 | Decision on Alexa+ secondary entry; MCP Apps card if time; SDK published to npm; Open Source contribution write-up |
| 21 to 22 | Oct 17 to 18 | Hardening: E2E, accessibility, copy lint, empty and error states, README Judge Quick Start, `docs/testing-instructions.md`, `docs/aws-integrations.md`, `docs/compliance.md`, friction log finalization |
| 23 | Oct 19 | Video script, screen recordings (Playground live view, emulator run, simulator), voiceover, captions |
| 24 | Oct 20 | Devpost page: description with criteria map, screenshots, product feedback, friction log summary, tracks; AWS credit form check (deadline Oct 21 12 PM PT) |
| 25 | Oct 21 | Submit draft on Devpost; verify video public in incognito; verify repo license detection; verify judges can run the quick start on a clean machine |
| 26 | Oct 22 | Buffer; final submission at least 12 hours before Oct 23 12:00 PM PDT (22:00 EAT) |

Cut order if behind: MCP Apps card, Alexa+ secondary, ops copilot, reports charts (keep one), PDF (keep JSON), WHEP live view (keep snapshot).

---

## 15. Demo and Video Plan

- **Dataset:** three clients (Okoro, Nakamura, Alvarez), six caregivers, two weeks, 84 visits: 72 completed (62 on time, 9 late arrivals, 1 double-visitor visit that the deterministic arrival rules resolve and attribute to the doorbell press), 5 early departures, 4 no-shows, and 3 unobservable (device offline, encrypted device, integration removed). EVV records with 6 contradictions and 8 missing clock-ins.
- **Recording:** 1440 px desktop for the console, 390 px for the family portal; OBS; Playground live view captured with provenance visible; emulator control visible as "Simulator" in the corner.
- **Script (2:50):** 0:00 hook and quantified claim ("2026 hard edits deny claims without a verified visit; VisitProof turns the Ring doorbell already at the door into proof of presence"); 0:20 Priya links Ring in the Ring Appstore flow (Playground) and sets consent; 0:45 a normal day: webhook arrives (log visible), status flips, 7 PM digest; 1:10 late arrival at 6:15, exception card, backfill; 1:40 reconciliation, contradicted clock-in, signed evidence pack and Open EVV export; 2:10 "did the caregiver come to Mom's today?" in Ask VisitProof; 2:30 architecture card (Ring APIs used, AWS services, MCP); 2:45 boundaries and what's next.
- **Never in the video:** third-party footage, music without rights, real people, real addresses.

---

## 16. Devpost Submission Content (Prepared Fields)

- Title: VisitProof. Tagline: "Proof of presence for home care, from the doorbell already at the door."
- Description sections: Inspiration; What It Does; How We Built It (Ring APIs with file paths; AWS services table; MCP; shadcn); Challenges (Playground event gap, TAKE, 60-second code exchange, nonce encoding); Accomplishments; What We Learned; What's Next; Criteria Map table; Testing Instructions; Product Feedback (Ring Partner API, Playground, Ring MCP, Bedrock, AgentCore, Strands, Kiro, Amplify, MCP SDK); Friction Log summary with link to `docs/friction-log.md`; Feature Requests.
- Tracks: Ring (primary), AWS Builder, Open Source; Alexa+ secondary if enabled.
- Links: GitHub repo (public, Apache-2.0), npm package, video, hosted demo with demo accounts.
- Images: hero (Today board in a laptop frame), flow (webhook to exception to family feed), architecture diagram, friction-log excerpt, reconciliation table.

---

## 17. Founder Answers (27 September 2026)

1. Ring developer registration is complete and credentials are stored in the git-ignored `.env`. Day 1 of the schedule is therefore done; the build starts with the monorepo scaffold.
2. AWS: existing account; region `us-east-1`; request the $150 hackathon credits by 21 October and set AWS Budgets alarms on first deploy.
3. Hardware: an iPhone is available; no Ring device, Echo, or Apple Watch. All demos run on the Ring Playground plus the emulator, as specified. The iPhone can record the demo video's family-portal segment at 390 px.
4. Team: solo. The schedule and the cut order in Section 14 stand.
5. No agency pilot contact yet. The Potential Impact section will rely on public market and EVV data (research.md Section 8) and on the founder's own domain experience; a pilot letter of intent is a nice-to-have, not a dependency.
6. Product name VisitProof confirmed. Alexa+ secondary entry approved if the simulator is polished by day 20.
7. Kiro plan: still open (Pro recommended for Crew jobs); Claude Code is the primary agent until decided.
